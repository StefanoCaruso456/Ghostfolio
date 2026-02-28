import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { Snaptrade } from 'snaptrade-typescript-sdk';

@Injectable()
export class SnaptradeService {
  private readonly logger = new Logger(SnaptradeService.name);
  private snaptradeClient: Snaptrade | null = null;

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly prismaService: PrismaService
  ) {
    const clientId = this.configurationService.get('SNAPTRADE_CLIENT_ID');
    const consumerKey = this.configurationService.get('SNAPTRADE_CONSUMER_KEY');

    if (clientId && consumerKey) {
      this.snaptradeClient = new Snaptrade({
        clientId,
        consumerKey
      });

      this.logger.log('Snaptrade client initialized');
    } else {
      this.logger.warn(
        `Snaptrade not configured — missing: ${[
          !clientId && 'SNAPTRADE_CLIENT_ID',
          !consumerKey && 'SNAPTRADE_CONSUMER_KEY'
        ]
          .filter(Boolean)
          .join(', ')}`
      );
    }
  }

  /**
   * Register the user with Snaptrade (if not already) and return a redirect URI
   * for the connection portal.
   */
  public async getConnectionPortalUri(
    userId: string
  ): Promise<{ redirectUri: string }> {
    this.ensureConfigured();

    let userSecret: string;

    // Check if user already has a SnapTrade connection with a userSecret
    let connection = await this.prismaService.snapTradeConnection.findFirst({
      where: { userId }
    });

    if (connection) {
      userSecret = connection.userSecret;
      this.logger.log(
        `Found existing Snaptrade connection for userId=${userId}`
      );
    } else {
      // Register a new Snaptrade user
      try {
        const registerResponse =
          await this.snaptradeClient.authentication.registerSnapTradeUser({
            userId
          });

        userSecret = registerResponse.data.userSecret;
      } catch (error) {
        const msg = this.extractErrorMessage(error, 'registration');

        this.logger.error(
          `Snaptrade registerSnapTradeUser failed: ${msg}`,
          error?.stack
        );

        throw new InternalServerErrorException(
          `Snaptrade user registration failed: ${msg}`
        );
      }

      // Store the connection record
      connection = await this.prismaService.snapTradeConnection.create({
        data: {
          userId,
          userSecret
        }
      });

      this.logger.log(`Registered Snaptrade user for userId=${userId}`);
    }

    // Get the redirect URI for the connection portal
    try {
      const loginResponse =
        await this.snaptradeClient.authentication.loginSnapTradeUser({
          userId,
          userSecret
        });

      const responseData = loginResponse.data as {
        redirectURI?: string;
        sessionId?: string;
      };

      this.logger.log(
        `Snaptrade loginSnapTradeUser response keys: ${Object.keys(responseData ?? {}).join(', ')}`
      );

      if (!responseData?.redirectURI) {
        this.logger.error(
          `Snaptrade loginSnapTradeUser returned no redirectURI. Full response data: ${JSON.stringify(responseData)}`
        );

        throw new ServiceUnavailableException(
          'Snaptrade did not return a redirect URI — the response may be encrypted or the API returned an unexpected format'
        );
      }

      return { redirectUri: responseData.redirectURI };
    } catch (error) {
      // Re-throw NestJS HTTP exceptions as-is
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      const msg = this.extractErrorMessage(error, 'login');

      this.logger.error(
        `Snaptrade loginSnapTradeUser failed: ${msg}`,
        error?.stack
      );

      throw new InternalServerErrorException(
        `Snaptrade connection portal failed: ${msg}`
      );
    }
  }

  /**
   * Called after user completes the connection portal.
   * Stores the authorizationId and syncs accounts.
   */
  public async handleConnectionSuccess(
    userId: string,
    authorizationId: string
  ): Promise<{ id: string; synced: number }> {
    this.ensureConfigured();

    const connection = await this.prismaService.snapTradeConnection.findFirst({
      where: { userId }
    });

    if (!connection) {
      throw new NotFoundException('No Snaptrade connection found for user');
    }

    // Update connection with the authorization ID
    await this.prismaService.snapTradeConnection.update({
      data: {
        authorizationId,
        status: 'ACTIVE'
      },
      where: { id: connection.id }
    });

    // Sync holdings
    const synced = await this.syncHoldings(userId, connection);

    return { id: connection.id, synced };
  }

  /**
   * Sync all holdings from Snaptrade into Ghostfolio accounts and orders.
   */
  public async syncConnection(
    userId: string,
    connectionId: string
  ): Promise<{ synced: number }> {
    this.ensureConfigured();

    const connection = await this.prismaService.snapTradeConnection.findUnique({
      where: { id: connectionId }
    });

    if (!connection) {
      throw new NotFoundException('Snaptrade connection not found');
    }

    if (connection.userId !== userId) {
      throw new ForbiddenException('Not your Snaptrade connection');
    }

    const synced = await this.syncHoldings(userId, connection);

    return { synced };
  }

  /**
   * Disconnect and delete a Snaptrade connection.
   */
  public async disconnectConnection(
    userId: string,
    connectionId: string
  ): Promise<void> {
    this.ensureConfigured();

    const connection = await this.prismaService.snapTradeConnection.findUnique({
      where: { id: connectionId }
    });

    if (!connection) {
      throw new NotFoundException('Snaptrade connection not found');
    }

    if (connection.userId !== userId) {
      throw new ForbiddenException('Not your Snaptrade connection');
    }

    // Try to delete the user from Snaptrade
    try {
      await this.snaptradeClient.authentication.deleteSnapTradeUser({
        userId
      });
    } catch (error) {
      this.logger.warn(
        `Failed to delete Snaptrade user for connection ${connectionId}: ${error?.message}`
      );
    }

    await this.prismaService.snapTradeConnection.delete({
      where: { id: connectionId }
    });

    this.logger.log(`Disconnected Snaptrade connection ${connectionId}`);
  }

  private async syncHoldings(
    userId: string,
    connection: { id: string; userSecret: string }
  ): Promise<number> {
    // Fetch all accounts from Snaptrade
    let snaptradeAccounts: any[];

    try {
      const accountsResponse =
        await this.snaptradeClient.accountInformation.listUserAccounts({
          userId,
          userSecret: connection.userSecret
        });

      snaptradeAccounts = accountsResponse.data ?? [];
    } catch (error) {
      const msg = this.extractErrorMessage(error, 'listUserAccounts');

      this.logger.error(`Snaptrade listUserAccounts failed: ${msg}`);

      throw new InternalServerErrorException(
        `Failed to fetch Snaptrade accounts: ${msg}`
      );
    }

    let synced = 0;

    for (const snapAccount of snaptradeAccounts) {
      const accountName = `Snaptrade – ${snapAccount.name || snapAccount.number || 'Account'}`;
      const snapAccountId = snapAccount.id;

      // Find or create a matching Ghostfolio account
      const existingAccount = await this.prismaService.account.findFirst({
        where: {
          comment: `snaptrade:${snapAccountId}`,
          userId
        }
      });

      let ghostfolioAccountId: string;

      if (existingAccount) {
        ghostfolioAccountId = existingAccount.id;

        await this.prismaService.account.update({
          data: { name: accountName },
          where: {
            id_userId: { id: existingAccount.id, userId }
          }
        });
      } else {
        const newAccount = await this.prismaService.account.create({
          data: {
            balance: 0,
            comment: `snaptrade:${snapAccountId}`,
            currency: snapAccount.meta?.currency ?? 'USD',
            name: accountName,
            userId
          }
        });
        ghostfolioAccountId = newAccount.id;
      }

      // Fetch positions for this account
      try {
        const positionsResponse =
          await this.snaptradeClient.accountInformation.getUserAccountPositions(
            {
              accountId: snapAccountId,
              userId,
              userSecret: connection.userSecret
            }
          );

        const positions = positionsResponse.data ?? [];

        for (const position of positions) {
          const symbol = position.symbol?.symbol?.symbol;

          if (!symbol) {
            continue;
          }

          // Check for existing order linked to this position
          const existingOrder = await this.prismaService.order.findFirst({
            where: {
              accountId: ghostfolioAccountId,
              comment: `snaptrade:${snapAccountId}:${symbol}`,
              userId
            }
          });

          const quantity = position.units ?? 0;
          const unitPrice =
            position.averagePurchasePrice ?? position.price ?? 0;

          if (existingOrder) {
            await this.prismaService.order.update({
              data: { quantity, unitPrice },
              where: { id: existingOrder.id }
            });
          } else {
            const symbolProfile =
              await this.prismaService.symbolProfile.findFirst({
                where: { symbol }
              });

            if (symbolProfile) {
              await this.prismaService.order.create({
                data: {
                  accountId: ghostfolioAccountId,
                  accountUserId: userId,
                  comment: `snaptrade:${snapAccountId}:${symbol}`,
                  currency: position.symbol?.symbol?.currency?.code ?? 'USD',
                  date: new Date(),
                  fee: 0,
                  quantity,
                  symbolProfileId: symbolProfile.id,
                  type: 'BUY',
                  unitPrice,
                  userId
                }
              });
              synced++;
            } else {
              this.logger.warn(
                `No SymbolProfile for ticker "${symbol}" — skipping`
              );
            }
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to sync positions for Snaptrade account ${snapAccountId}: ${error?.message}`
        );
      }
    }

    // Update sync timestamp
    await this.prismaService.snapTradeConnection.update({
      data: { lastSyncedAt: new Date(), status: 'ACTIVE' },
      where: { id: connection.id }
    });

    this.logger.log(
      `Synced ${synced} holdings from Snaptrade connection ${connection.id}`
    );

    return synced;
  }

  private ensureConfigured(): void {
    if (!this.snaptradeClient) {
      throw new ServiceUnavailableException(
        'Snaptrade is not configured — check SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY env vars'
      );
    }
  }

  private extractErrorMessage(error: any, context: string): string {
    // Snaptrade SDK wraps errors in axios-style responses
    const responseMsg =
      error?.response?.data?.message ||
      error?.response?.data?.detail ||
      error?.response?.data?.error;
    const status = error?.response?.status;

    if (responseMsg) {
      return `HTTP ${status}: ${responseMsg}`;
    }

    if (error?.message) {
      return error.message;
    }

    return `Unknown ${context} error`;
  }
}
