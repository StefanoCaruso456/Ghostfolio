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
    const encryptionKey =
      this.configurationService.get('PLAID_ENCRYPTION_KEY');

    // Validate encryption key format if provided
    if (encryptionKey && !/^[0-9a-f]{64}$/i.test(encryptionKey)) {
      this.logger.error(
        'PLAID_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Generate with: openssl rand -hex 32'
      );
    }

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
      this.logger.log(
        `Plaid client initialized (env=${env}, products=[Investments])`
      );
    } else {
      this.logger.warn(
        `Plaid not configured — missing: ${[
          !clientId && 'PLAID_CLIENT_ID/PLAID_API_KEY',
          !secret && 'PLAID_SECRET'
        ]
          .filter(Boolean)
          .join(', ')}`
      );
    }
  }

  public async createLinkToken(
    userId: string
  ): Promise<{ linkToken: string }> {
    this.ensureConfigured();

    const webhookUrl = this.configurationService.get('PLAID_WEBHOOK_URL');

    try {
      const response = await this.plaidClient.linkTokenCreate({
        client_name: 'Ghostfolio',
        country_codes: [CountryCode.Us],
        language: 'en',
        products: [Products.Investments],
        user: { client_user_id: userId },
        ...(webhookUrl ? { webhook: webhookUrl } : {})
      });

      return { linkToken: response.data.link_token };
    } catch (error) {
      this.logger.error(
        `Plaid linkTokenCreate failed: code=${error?.response?.data?.error_code ?? 'unknown'}, type=${error?.response?.data?.error_type ?? 'unknown'}, message=${error?.response?.data?.error_message ?? error.message}`
      );
      throw error;
    }
  }

  public async exchangePublicToken(
    userId: string,
    dto: ExchangePlaidTokenDto
  ): Promise<{
    id: string;
    institutionName: string;
    itemId: string;
    status: string;
  }> {
    this.ensureConfigured();

    const encryptionKey =
      this.configurationService.get('PLAID_ENCRYPTION_KEY');

    if (!encryptionKey) {
      throw new ServiceUnavailableException(
        'PLAID_ENCRYPTION_KEY is not configured'
      );
    }

    try {
      const response = await this.plaidClient.itemPublicTokenExchange({
        public_token: dto.publicToken
      });

      const accessToken = response.data.access_token;
      const itemId = response.data.item_id;

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

      // Return safe DTO — NEVER expose encryptedAccessToken
      return {
        id: plaidItem.id,
        institutionName: plaidItem.institutionName,
        itemId: plaidItem.itemId,
        status: plaidItem.status
      };
    } catch (error) {
      this.logger.error(
        `Plaid token exchange failed: code=${error?.response?.data?.error_code ?? 'unknown'}, message=${error?.response?.data?.error_message ?? error.message}`
      );
      throw error;
    }
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

    const encryptionKey =
      this.configurationService.get('PLAID_ENCRYPTION_KEY');
    const accessToken = decrypt(
      plaidItem.encryptedAccessToken,
      encryptionKey
    );

    let holdingsResponse;

    try {
      holdingsResponse = await this.plaidClient.investmentsHoldingsGet({
        access_token: accessToken
      });
    } catch (error) {
      const errorCode = error?.response?.data?.error_code;

      this.logger.error(
        `Plaid investmentsHoldingsGet failed for item ${plaidItemId}: code=${errorCode ?? 'unknown'}, message=${error?.response?.data?.error_message ?? error.message}`
      );

      // Update PlaidItem status based on error type
      if (
        errorCode === 'ITEM_LOGIN_REQUIRED' ||
        errorCode === 'PENDING_EXPIRATION'
      ) {
        await this.prismaService.plaidItem.update({
          data: { status: 'LOGIN_REQUIRED' },
          where: { id: plaidItemId }
        });
      } else {
        await this.prismaService.plaidItem.update({
          data: { status: 'ERROR' },
          where: { id: plaidItemId }
        });
      }

      throw error;
    }

    const { accounts, holdings, securities } = holdingsResponse.data;

    let synced = 0;

    for (const plaidAccount of accounts) {
      const accountName = `${plaidItem.institutionName} – ${plaidAccount.name ?? plaidAccount.official_name ?? 'Account'}`;

      // Deterministic match by plaidAccountId
      const existingAccount = await this.prismaService.account.findFirst({
        where: {
          plaidAccountId: plaidAccount.account_id,
          userId
        }
      });

      let ghostfolioAccountId: string;

      if (existingAccount) {
        ghostfolioAccountId = existingAccount.id;

        // Update balance and name on every sync
        await this.prismaService.account.update({
          data: {
            balance: plaidAccount.balances?.current ?? 0,
            name: accountName
          },
          where: {
            id_userId: { id: existingAccount.id, userId }
          }
        });
      } else {
        const newAccount = await this.prismaService.account.create({
          data: {
            balance: plaidAccount.balances?.current ?? 0,
            currency: plaidAccount.balances?.iso_currency_code ?? 'USD',
            name: accountName,
            plaidAccountId: plaidAccount.account_id,
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
                accountUserId: userId,
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
          } else {
            this.logger.warn(
              `No SymbolProfile for ticker "${security.ticker_symbol}" — skipping`
            );
          }
        }
      }
    }

    // Update last synced timestamp and reset status to ACTIVE
    await this.prismaService.plaidItem.update({
      data: { lastSyncedAt: new Date(), status: 'ACTIVE' },
      where: { id: plaidItemId }
    });

    this.logger.log(
      `Synced ${synced} holdings from PlaidItem ${plaidItemId}`
    );

    return { synced };
  }

  public async handleWebhook(body: {
    item_id: string;
    webhook_code: string;
    webhook_type: string;
  }): Promise<{ received: true }> {
    const { item_id, webhook_code, webhook_type } = body;

    this.logger.log(
      `Webhook received: ${webhook_type}/${webhook_code} for item_id=${item_id}`
    );

    const plaidItem = await this.prismaService.plaidItem.findUnique({
      where: { itemId: item_id }
    });

    if (!plaidItem) {
      this.logger.warn(`Webhook for unknown item_id: ${item_id}`);
      return { received: true };
    }

    switch (webhook_type) {
      case 'HOLDINGS':
        if (webhook_code === 'DEFAULT_UPDATE') {
          try {
            await this.syncItem(plaidItem.userId, plaidItem.id);
          } catch (error) {
            this.logger.error(
              `Webhook-triggered sync failed for PlaidItem ${plaidItem.id}: ${error.message}`
            );
          }
        }
        break;

      case 'ITEM':
        if (webhook_code === 'ERROR') {
          await this.prismaService.plaidItem.update({
            data: { status: 'ERROR' },
            where: { id: plaidItem.id }
          });
        } else if (webhook_code === 'PENDING_EXPIRATION') {
          await this.prismaService.plaidItem.update({
            data: { status: 'LOGIN_REQUIRED' },
            where: { id: plaidItem.id }
          });
        }
        break;

      default:
        this.logger.log(
          `Unhandled webhook: ${webhook_type}/${webhook_code}`
        );
    }

    return { received: true };
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
      throw new ServiceUnavailableException(
        'Plaid is not configured — check PLAID_CLIENT_ID/PLAID_API_KEY and PLAID_SECRET env vars'
      );
    }
  }
}
