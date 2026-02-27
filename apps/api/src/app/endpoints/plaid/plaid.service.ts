import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_PLAID_CLIENT_ID,
  PROPERTY_API_KEY_PLAID_SECRET,
  PROPERTY_PLAID_ENV
} from '@ghostfolio/common/config';

import { HttpException, Injectable, Logger } from '@nestjs/common';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products
} from 'plaid';

@Injectable()
export class PlaidService {
  private readonly logger = new Logger(PlaidService.name);

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly prismaService: PrismaService,
    private readonly propertyService: PropertyService
  ) {}

  private async getPlaidClient(): Promise<PlaidApi> {
    // Try env vars first (PLAID_CLIENT_ID / PLAID_SECRET), then Property table
    let clientId =
      this.configurationService.get('PLAID_CLIENT_ID') ||
      (await this.propertyService.getByKey<string>(
        PROPERTY_API_KEY_PLAID_CLIENT_ID
      ));

    let secret =
      this.configurationService.get('PLAID_SECRET') ||
      (await this.propertyService.getByKey<string>(
        PROPERTY_API_KEY_PLAID_SECRET
      ));

    // Also check Railway env var names: PLAID_API_KEY
    if (!clientId) {
      clientId = process.env.PLAID_API_KEY || '';
    }
    if (!secret) {
      secret = process.env.PLAID_ENCRYPTION_KEY || '';
    }

    const plaidEnv =
      this.configurationService.get('PLAID_ENV') ||
      (await this.propertyService.getByKey<string>(PROPERTY_PLAID_ENV)) ||
      'sandbox';

    if (!clientId || !secret) {
      throw new HttpException(
        'Plaid API credentials are not configured. Set PLAID_CLIENT_ID and PLAID_SECRET environment variables or configure them in Admin Settings.',
        StatusCodes.SERVICE_UNAVAILABLE
      );
    }

    // Strip any wrapping quotes from values
    clientId = String(clientId).replace(/^["']|["']$/g, '');
    secret = String(secret).replace(/^["']|["']$/g, '');

    const configuration = new Configuration({
      basePath: PlaidEnvironments[plaidEnv] || PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
          'Plaid-Version': '2020-09-14'
        }
      }
    });

    return new PlaidApi(configuration);
  }

  public async createLinkToken({
    userId
  }: {
    userId: string;
  }): Promise<{ linkToken: string }> {
    try {
      const client = await this.getPlaidClient();

      const response = await client.linkTokenCreate({
        user: { client_user_id: userId },
        client_name: 'Ghostfolio',
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: 'en'
      });

      return { linkToken: response.data.link_token };
    } catch (error) {
      this.logger.error(
        `Failed to create Plaid link token: ${error.message}`,
        error.stack
      );
      throw new HttpException(
        `Failed to create Plaid link token: ${error?.response?.data?.error_message || error.message}`,
        StatusCodes.BAD_GATEWAY
      );
    }
  }

  public async exchangePublicToken({
    publicToken,
    userId
  }: {
    publicToken: string;
    userId: string;
  }): Promise<{ itemId: string; accounts: any[] }> {
    try {
      const client = await this.getPlaidClient();

      // Exchange public token for access token
      const tokenResponse = await client.itemPublicTokenExchange({
        public_token: publicToken
      });

      const accessToken = tokenResponse.data.access_token;
      const itemId = tokenResponse.data.item_id;

      // Fetch accounts from the linked institution
      const accountsResponse = await client.accountsGet({
        access_token: accessToken
      });

      const plaidAccounts = accountsResponse.data.accounts;

      // Store the access token securely in the Property table (per-user key)
      await this.propertyService.put({
        key: `PLAID_ACCESS_TOKEN_${userId}`,
        value: JSON.stringify({ accessToken, itemId })
      });

      // Create Ghostfolio accounts for each Plaid account
      const createdAccounts = [];

      for (const plaidAccount of plaidAccounts) {
        const existingAccount =
          await this.prismaService.account.findFirst({
            where: {
              userId,
              name: plaidAccount.name
            }
          });

        if (!existingAccount) {
          const account = await this.prismaService.account.create({
            data: {
              balance: plaidAccount.balances.current || 0,
              currency: 'USD',
              id: undefined,
              name:
                plaidAccount.name ||
                plaidAccount.official_name ||
                'Plaid Account',
              userId
            }
          });
          createdAccounts.push(account);
        } else {
          // Update existing account balance
          await this.prismaService.account.update({
            data: { balance: plaidAccount.balances.current || 0 },
            where: {
              id_userId: {
                id: existingAccount.id,
                userId
              }
            }
          });
          createdAccounts.push(existingAccount);
        }
      }

      this.logger.log(
        `Plaid link completed for user ${userId}: ${plaidAccounts.length} accounts synced`
      );

      return {
        itemId,
        accounts: plaidAccounts.map((a) => ({
          plaidAccountId: a.account_id,
          name: a.name || a.official_name,
          type: a.type,
          subtype: a.subtype,
          balanceCurrent: a.balances.current,
          balanceAvailable: a.balances.available,
          currency: a.balances.iso_currency_code || 'USD'
        }))
      };
    } catch (error) {
      this.logger.error(
        `Failed to exchange Plaid public token: ${error.message}`,
        error.stack
      );
      throw new HttpException(
        `Failed to connect broker: ${error?.response?.data?.error_message || error.message}`,
        StatusCodes.BAD_GATEWAY
      );
    }
  }

  public async getAccounts({ userId }: { userId: string }) {
    try {
      const client = await this.getPlaidClient();
      const stored = await this.propertyService.getByKey<{
        accessToken: string;
        itemId: string;
      }>(`PLAID_ACCESS_TOKEN_${userId}`);

      if (!stored?.accessToken) {
        return { accounts: [] };
      }

      const response = await client.accountsGet({
        access_token: stored.accessToken
      });

      return {
        accounts: response.data.accounts.map((a) => ({
          plaidAccountId: a.account_id,
          name: a.name || a.official_name,
          type: a.type,
          subtype: a.subtype,
          balanceCurrent: a.balances.current,
          balanceAvailable: a.balances.available,
          currency: a.balances.iso_currency_code || 'USD'
        }))
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch Plaid accounts: ${error.message}`,
        error.stack
      );
      throw new HttpException(
        `Failed to fetch accounts: ${error?.response?.data?.error_message || error.message}`,
        StatusCodes.BAD_GATEWAY
      );
    }
  }

  public async syncBalances({ userId }: { userId: string }) {
    try {
      const client = await this.getPlaidClient();
      const stored = await this.propertyService.getByKey<{
        accessToken: string;
        itemId: string;
      }>(`PLAID_ACCESS_TOKEN_${userId}`);

      if (!stored?.accessToken) {
        return { synced: 0 };
      }

      const response = await client.accountsBalanceGet({
        access_token: stored.accessToken
      });

      let synced = 0;

      for (const plaidAccount of response.data.accounts) {
        const name =
          plaidAccount.name || plaidAccount.official_name || 'Plaid Account';

        const existingAccount =
          await this.prismaService.account.findFirst({
            where: { userId, name }
          });

        if (existingAccount) {
          await this.prismaService.account.update({
            data: { balance: plaidAccount.balances.current || 0 },
            where: {
              id_userId: {
                id: existingAccount.id,
                userId
              }
            }
          });
          synced++;
        }
      }

      return { synced };
    } catch (error) {
      this.logger.error(
        `Failed to sync Plaid balances: ${error.message}`,
        error.stack
      );
      throw new HttpException(
        `Failed to sync balances: ${error?.response?.data?.error_message || error.message}`,
        StatusCodes.BAD_GATEWAY
      );
    }
  }
}
