import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { ExchangePlaidTokenDto } from '@ghostfolio/common/dtos';

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { PlaidItem } from '@prisma/client';
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products
} from 'plaid';

import { decrypt, encrypt } from './plaid-encryption.util';

@Injectable()
export class PlaidService {
  private readonly logger = new Logger(PlaidService.name);
  private plaidClient: PlaidApi | null = null;

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly prismaService: PrismaService
  ) {
    const clientId =
      this.configurationService.get('PLAID_CLIENT_ID') ||
      this.configurationService.get('PLAID_API_KEY');
    const secret = this.configurationService.get('PLAID_SECRET');
    const env = this.configurationService.get('PLAID_ENV');

    if (clientId && secret) {
      const configuration = new Configuration({
        basePath:
          PlaidEnvironments[env as keyof typeof PlaidEnvironments] ??
          PlaidEnvironments.sandbox,
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': clientId,
            'PLAID-SECRET': secret
          }
        }
      });

      this.plaidClient = new PlaidApi(configuration);
      this.logger.log(`Plaid client initialized (env=${env})`);
    } else {
      this.logger.warn(
        'Plaid not configured: PLAID_CLIENT_ID or PLAID_SECRET missing'
      );
    }
  }

  public async createLinkToken(userId: string): Promise<{ linkToken: string }> {
    this.ensureConfigured();

    const response = await this.plaidClient.linkTokenCreate({
      client_name: 'Ghostfolio',
      country_codes: [CountryCode.Us],
      language: 'en',
      products: [Products.Investments],
      user: { client_user_id: userId }
    });

    return { linkToken: response.data.link_token };
  }

  public async exchangePublicToken(
    userId: string,
    dto: ExchangePlaidTokenDto
  ): Promise<PlaidItem> {
    this.ensureConfigured();

    const response = await this.plaidClient.itemPublicTokenExchange({
      public_token: dto.publicToken
    });

    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    const encryptionKey = this.configurationService.get('PLAID_ENCRYPTION_KEY');
    const encryptedAccessToken = encrypt(accessToken, encryptionKey);

    const plaidItem = await this.prismaService.plaidItem.create({
      data: {
        encryptedAccessToken,
        institutionId: dto.institutionId,
        institutionName: dto.institutionName,
        itemId,
        userId
      }
    });

    this.logger.log(
      `Created PlaidItem ${plaidItem.id} for user ${userId} (institution: ${dto.institutionName})`
    );

    return plaidItem;
  }

  public async syncItem(
    userId: string,
    plaidItemId: string
  ): Promise<{ synced: number }> {
    this.ensureConfigured();

    const plaidItem = await this.prismaService.plaidItem.findUnique({
      where: { id: plaidItemId }
    });

    if (!plaidItem) {
      throw new NotFoundException('Plaid item not found');
    }

    if (plaidItem.userId !== userId) {
      throw new ForbiddenException('Not your Plaid item');
    }

    const encryptionKey = this.configurationService.get('PLAID_ENCRYPTION_KEY');
    const accessToken = decrypt(plaidItem.encryptedAccessToken, encryptionKey);

    const holdingsResponse = await this.plaidClient.investmentsHoldingsGet({
      access_token: accessToken
    });

    const { accounts, holdings, securities } = holdingsResponse.data;

    let synced = 0;

    for (const plaidAccount of accounts) {
      // Upsert a Ghostfolio Account for each Plaid account
      const accountName = `${plaidItem.institutionName} – ${plaidAccount.name ?? plaidAccount.official_name ?? 'Account'}`;

      const existingAccounts = await this.prismaService.account.findMany({
        where: {
          name: accountName,
          userId
        }
      });

      let ghostfolioAccountId: string;

      if (existingAccounts.length > 0) {
        ghostfolioAccountId = existingAccounts[0].id;
      } else {
        const newAccount = await this.prismaService.account.create({
          data: {
            balance: plaidAccount.balances?.current ?? 0,
            currency: plaidAccount.balances?.iso_currency_code ?? 'USD',
            name: accountName,
            userId
          }
        });
        ghostfolioAccountId = newAccount.id;
      }

      // Sync holdings for this account
      const accountHoldings = holdings.filter(
        (h) => h.account_id === plaidAccount.account_id
      );

      for (const holding of accountHoldings) {
        const security = securities?.find(
          (s) => s.security_id === holding.security_id
        );

        if (!security?.ticker_symbol) {
          continue;
        }

        // Check if we already have this holding as an activity
        const existingOrder = await this.prismaService.order.findFirst({
          where: {
            accountId: ghostfolioAccountId,
            comment: `plaid:${holding.security_id}`,
            userId
          }
        });

        if (existingOrder) {
          // Update quantity and price
          await this.prismaService.order.update({
            data: {
              quantity: holding.quantity,
              unitPrice: holding.institution_price ?? 0
            },
            where: { id: existingOrder.id }
          });
        } else {
          // Look for a matching SymbolProfile
          const symbolProfile =
            await this.prismaService.symbolProfile.findFirst({
              where: {
                symbol: security.ticker_symbol
              }
            });

          if (symbolProfile) {
            await this.prismaService.order.create({
              data: {
                accountId: ghostfolioAccountId,
                comment: `plaid:${holding.security_id}`,
                currency: holding.iso_currency_code ?? 'USD',
                date: new Date(),
                fee: 0,
                quantity: holding.quantity,
                symbolProfileId: symbolProfile.id,
                type: 'BUY',
                unitPrice: holding.institution_price ?? 0,
                userId
              }
            });
            synced++;
          }
        }
      }
    }

    // Update last synced timestamp
    await this.prismaService.plaidItem.update({
      data: { lastSyncedAt: new Date() },
      where: { id: plaidItemId }
    });

    this.logger.log(`Synced ${synced} holdings from PlaidItem ${plaidItemId}`);

    return { synced };
  }

  public async disconnectItem(
    userId: string,
    plaidItemId: string
  ): Promise<void> {
    this.ensureConfigured();

    const plaidItem = await this.prismaService.plaidItem.findUnique({
      where: { id: plaidItemId }
    });

    if (!plaidItem) {
      throw new NotFoundException('Plaid item not found');
    }

    if (plaidItem.userId !== userId) {
      throw new ForbiddenException('Not your Plaid item');
    }

    // Revoke access token at Plaid
    try {
      const encryptionKey = this.configurationService.get(
        'PLAID_ENCRYPTION_KEY'
      );
      const accessToken = decrypt(
        plaidItem.encryptedAccessToken,
        encryptionKey
      );

      await this.plaidClient.itemRemove({ access_token: accessToken });
    } catch (error) {
      this.logger.warn(
        `Failed to revoke Plaid access token for item ${plaidItemId}: ${error.message}`
      );
    }

    await this.prismaService.plaidItem.delete({
      where: { id: plaidItemId }
    });

    this.logger.log(`Disconnected PlaidItem ${plaidItemId}`);
  }

  private ensureConfigured(): void {
    if (!this.plaidClient) {
      throw new ServiceUnavailableException('Plaid is not configured');
    }
  }
}
