/**
 * revert-uuid-symbols.ts
 *
 * Reverts UUID-based SymbolProfiles from YAHOO back to MANUAL.
 *
 * Root Cause:
 *   The MANUAL→YAHOO migration changed ALL profiles to YAHOO, but symbols
 *   that are UUIDs (like "66f48fcc-c3ef-4e1c-...") are custom/manual entries
 *   that Yahoo Finance cannot provide data for. The portfolio calculator expects
 *   MarketData rows for YAHOO symbols but finds none → empty holdings.
 *
 *   MANUAL symbols work differently: the calculator uses order unitPrice
 *   directly, no MarketData rows needed.
 *
 * What it does:
 *   1. Finds all YAHOO SymbolProfiles where the symbol looks like a UUID
 *   2. Reverts them to dataSource: MANUAL
 *   3. Also reverts any MarketData rows for those symbols back to MANUAL
 *   4. Leaves real ticker symbols (AAPL, BRK.B, etc.) as YAHOO
 *
 * Usage:
 *   # Dry run (see what would change):
 *   DATABASE_URL="..." npx ts-node --compiler-options '{"module":"commonjs"}' scripts/revert-uuid-symbols.ts
 *
 *   # Fix mode:
 *   DATABASE_URL="..." npx ts-node --compiler-options '{"module":"commonjs"}' scripts/revert-uuid-symbols.ts --fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FIX_MODE = process.argv.includes('--fix');

// UUID v4 pattern: 8-4-4-4-12 hex chars
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(symbol: string): boolean {
  return UUID_REGEX.test(symbol);
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║    Revert UUID Symbols to MANUAL                 ║');
  console.log(`║    Mode: ${FIX_MODE ? '🔧 FIX (will modify data)' : '🔍 DRY RUN (preview only) '}        ║`);
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // 1. Find all YAHOO SymbolProfiles
  const yahooProfiles = await prisma.symbolProfile.findMany({
    where: { dataSource: 'YAHOO' },
    select: {
      id: true,
      symbol: true,
      _count: { select: { activities: true } }
    }
  });

  console.log(`Total YAHOO SymbolProfiles: ${yahooProfiles.length}\n`);

  // 2. Separate into UUID vs real ticker
  const uuidProfiles = yahooProfiles.filter((p) => isUuid(p.symbol));
  const tickerProfiles = yahooProfiles.filter((p) => !isUuid(p.symbol));

  console.log(`UUID symbols (to revert to MANUAL): ${uuidProfiles.length}`);
  console.log(`Real ticker symbols (keep as YAHOO): ${tickerProfiles.length}`);

  if (tickerProfiles.length > 0) {
    console.log('\nReal tickers staying as YAHOO:');
    for (const p of tickerProfiles) {
      console.log(`  ✅ ${p.symbol} (${p._count.activities} activities)`);
    }
  }

  if (uuidProfiles.length === 0) {
    console.log('\n✅ No UUID symbols found. Nothing to revert.');
    return;
  }

  // 3. Count MarketData rows that would be affected
  const uuidSymbols = uuidProfiles.map((p) => p.symbol);
  const mdCount = await prisma.marketData.count({
    where: {
      dataSource: 'YAHOO',
      symbol: { in: uuidSymbols }
    }
  });

  console.log(`\nYAHOO MarketData rows for UUID symbols: ${mdCount}`);

  if (!FIX_MODE) {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  DRY RUN — No changes made.');
    console.log('  Run with --fix to revert UUID symbols to MANUAL:');
    console.log(
      "    DATABASE_URL=\"...\" npx ts-node --compiler-options '{\"module\":\"commonjs\"}' scripts/revert-uuid-symbols.ts --fix"
    );
    console.log('══════════════════════════════════════════════════');
    return;
  }

  // ── APPLY FIX ──

  console.log('\nReverting...\n');

  // 4a. Revert SymbolProfiles
  const profileResult = await prisma.symbolProfile.updateMany({
    where: {
      dataSource: 'YAHOO',
      symbol: { in: uuidSymbols }
    },
    data: { dataSource: 'MANUAL' }
  });

  console.log(`✅ Reverted ${profileResult.count} SymbolProfiles to MANUAL`);

  // 4b. Revert MarketData (if any exist for UUID symbols)
  if (mdCount > 0) {
    const mdResult = await prisma.marketData.updateMany({
      where: {
        dataSource: 'YAHOO',
        symbol: { in: uuidSymbols }
      },
      data: { dataSource: 'MANUAL' }
    });

    console.log(`✅ Reverted ${mdResult.count} MarketData rows to MANUAL`);
  }

  // 5. Verify final state
  const finalCounts = await prisma.symbolProfile.groupBy({
    by: ['dataSource'],
    _count: true,
    orderBy: { dataSource: 'asc' }
  });

  console.log('\n══════════════════════════════════════════════════');
  console.log('  FINAL STATE');
  console.log('══════════════════════════════════════════════════');
  for (const row of finalCounts) {
    console.log(`  ${row.dataSource}: ${row._count} SymbolProfiles`);
  }
  console.log('══════════════════════════════════════════════════');
  console.log(
    '\n✅ Done! UUID symbols reverted to MANUAL. Portfolio should load correctly.'
  );
  console.log('   Do a hard refresh in your browser: Cmd+Shift+R (Mac) or Ctrl+Shift+R');
}

main()
  .catch((e) => {
    console.error('Script failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
