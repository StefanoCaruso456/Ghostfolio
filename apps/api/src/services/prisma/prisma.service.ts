import {
  Injectable,
  Logger,
  LogLevel,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

const KEEPALIVE_INTERVAL_MS = 120_000; // 2 minutes

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  public constructor(configService: ConfigService) {
    let customLogLevels: LogLevel[];

    try {
      customLogLevels = JSON.parse(
        configService.get<string>('LOG_LEVELS')
      ) as LogLevel[];
    } catch {}

    const log: Prisma.LogDefinition[] =
      customLogLevels?.includes('debug') || customLogLevels?.includes('verbose')
        ? [{ emit: 'stdout', level: 'query' }]
        : [];

    super({
      log,
      errorFormat: 'colorless'
    });
  }

  public async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      Logger.error(error, 'PrismaService');
    }
  }

  public async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Lightweight DB ping to keep connection pool alive during long computations.
   * Throttled to at most once per KEEPALIVE_INTERVAL_MS to avoid spamming.
   */
  private lastKeepaliveAt = 0;

  public async keepAlive(): Promise<void> {
    const now = Date.now();

    if (now - this.lastKeepaliveAt < KEEPALIVE_INTERVAL_MS) {
      return; // Already pinged recently, skip
    }

    this.lastKeepaliveAt = now;

    try {
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      Logger.warn(
        `DB keepalive failed, attempting reconnect: ${error?.message}`,
        'PrismaService'
      );

      try {
        await this.$disconnect();
        await this.$connect();
        Logger.log('DB reconnected after keepalive failure', 'PrismaService');
      } catch (reconnectError) {
        Logger.error(
          `DB reconnect failed: ${reconnectError?.message}`,
          'PrismaService'
        );
      }
    }
  }
}
