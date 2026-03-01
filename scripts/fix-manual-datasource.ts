/**
 * fix-manual-datasource.ts
 *
 * One-time script to migrate SymbolProfile records from DataSource.MANUAL
 * to DataSource.YAHOO so the data gathering cron can fetch real market prices.
 *
 * What it does:
 * 1. Finds all SymbolProfile records where dataSource = 'MANUAL'
 * 2. For each, checks if a YAHOO profile already exists for that symbol
 *    - If NO YAHOO profile exists: updates dataSource from MANUAL → YAHOO
 *    - If a YAHOO profile exists: re-points all Orders to the YAHOO profile,
 *      deletes the orphaned MANUAL profile
 * 3. Logs everything it does
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/fix-manual-datasource.ts
 *
 * Or on Railway (with DATABASE_URL set):
 *   npx ts-node scripts/fix-manual-datasource.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Fix MANUAL DataSource Migration ===\n');

  // 1. Find all MANUAL symbol profiles
  const manualProfiles = await prisma.symbolProfile.findMany({
    where: { dataSource: 'MANUAL' },
    include: {
      activities: { select: { id: true } },
      _count: { select: { activities: true } }
    }
  });

  console.log(`Found ${manualProfiles.length} MANUAL symbol profiles\n`);

  if (manualProfiles.length === 0) {
    console.log(
      'Nothing to migrate. All profiles already have correct data sources.'
    );
    return;
  }

  let updated = 0;
  let merged = 0;
  let skipped = 0;
  let errors = 0;

  for (const manual of manualProfiles) {
    const symbol = manual.symbol;

    try {
      // 2. Check if a YAHOO profile already exists for this symbol
      const yahooProfile = await prisma.symbolProfile.findUnique({
        where: {
          dataSource_symbol: {
            dataSource: 'YAHOO',
            symbol
          }
        }
      });

      if (!yahooProfile) {
        // No YAHOO profile exists — safe to update in place
        await prisma.symbolProfile.update({
          where: { id: manual.id },
          data: { dataSource: 'YAHOO' }
        });

        // Also update any MarketData records for this symbol
        await prisma.marketData.updateMany({
          where: {
            dataSource: 'MANUAL',
            symbol
          },
          data: { dataSource: 'YAHOO' }
        });

        console.log(
          `✅ ${symbol}: Updated MANUAL → YAHOO (${manual._count.activities} activities)`
        );
        updated++;
      } else {
        // YAHOO profile already exists — merge orders into it
        const orderIds = manual.activities.map((a) => a.id);

        if (orderIds.length > 0) {
          await prisma.order.updateMany({
            where: { id: { in: orderIds } },
            data: { symbolProfileId: yahooProfile.id }
          });
        }

        // Delete any MANUAL MarketData for this symbol (YAHOO data will be fetched)
        await prisma.marketData.deleteMany({
          where: {
            dataSource: 'MANUAL',
            symbol
          }
        });

        // Delete the orphaned MANUAL profile (orders already moved)
        // First check for SymbolProfileOverrides
        await prisma.symbolProfileOverrides.deleteMany({
          where: { symbolProfileId: manual.id }
        });

        await prisma.symbolProfile.delete({
          where: { id: manual.id }
        });

        console.log(
          `🔀 ${symbol}: Merged ${orderIds.length} orders into existing YAHOO profile, deleted MANUAL duplicate`
        );
        merged++;
      }
    } catch (error) {
      console.error(
        `❌ ${symbol}: Failed — ${error instanceof Error ? error.message : error}`
      );
      errors++;
    }
  }

  console.log('\n=== Migration Summary ===');
  console.log(`Updated (MANUAL → YAHOO): ${updated}`);
  console.log(`Merged into existing YAHOO: ${merged}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total processed: ${updated + merged + skipped + errors}`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
