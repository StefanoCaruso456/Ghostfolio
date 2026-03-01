/**
 * repair-market-data.ts
 *
 * Diagnoses and repairs MarketData gaps caused by the MANUAL→YAHOO
 * migration script (fix-manual-datasource.ts).
 *
 * Root Cause:
 *   The migration changed SymbolProfile.dataSource from MANUAL→YAHOO but
 *   MarketData rows may have:
 *     (a) Failed to update (unique constraint on [dataSource,date,symbol])
 *     (b) Been deleted (merged-symbol path) without replacement
 *   The portfolio calculator queries MarketData WHERE dataSource='YAHOO'
 *   and gets 0 rows → empty holdings, 0% analysis/performance.
 *
 * What it does:
 *   1. DIAGNOSE — report state of SymbolProfiles and MarketData
 *   2. REPAIR  — backfill missing MarketData from Yahoo Finance API
 *
 * Usage:
 *   # Dry run (diagnose only, no changes):
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/repair-market-data.ts
 *
 *   # Fix mode (diagnose + repair):
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/repair-market-data.ts --fix
 *
 *   # On Railway:
 *   railway run npx ts-node scripts/repair-market-data.ts --fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FIX_MODE = process.argv.includes('--fix');

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function resetHours(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function subDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Dynamically import yahoo-finance2 (ESM package) */
async function getYahooFinance() {
  const yf = await (Function('return import("yahoo-finance2")')() as Promise<any>);
  return yf.default || yf;
}

// ────────────────────────────────────────────────────────────────────
// Phase 1: Diagnose
// ────────────────────────────────────────────────────────────────────

async function diagnose() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  PHASE 1 — DIAGNOSE');
  console.log('═══════════════════════════════════════════════════\n');

  // 1a. Count SymbolProfiles by dataSource
  const profileCounts = await prisma.symbolProfile.groupBy({
    by: ['dataSource'],
    _count: true,
    orderBy: { dataSource: 'asc' }
  });

  console.log('SymbolProfile counts by dataSource:');
  for (const row of profileCounts) {
    console.log(`  ${row.dataSource}: ${row._count}`);
  }

  // 1b. Count MarketData by dataSource
  const mdCounts = await prisma.marketData.groupBy({
    by: ['dataSource'],
    _count: true,
    orderBy: { dataSource: 'asc' }
  });

  console.log('\nMarketData counts by dataSource:');
  for (const row of mdCounts) {
    console.log(`  ${row.dataSource}: ${row._count}`);
  }

  // 1c. Find YAHOO SymbolProfiles that have orders (active holdings)
  const yahooProfilesWithOrders = await prisma.symbolProfile.findMany({
    where: {
      dataSource: 'YAHOO',
      activities: { some: {} }
    },
    select: { id: true, symbol: true }
  });

  console.log(
    `\nYAHOO SymbolProfiles with ≥1 order: ${yahooProfilesWithOrders.length}`
  );

  // 1d. For each, check MarketData presence
  const missingMarketData: { id: string; symbol: string }[] = [];
  const hasMarketData: { id: string; symbol: string; count: number }[] = [];

  for (const profile of yahooProfilesWithOrders) {
    const count = await prisma.marketData.count({
      where: { dataSource: 'YAHOO', symbol: profile.symbol }
    });

    if (count === 0) {
      missingMarketData.push(profile);
    } else {
      hasMarketData.push({ ...profile, count });
    }
  }

  console.log(`  ✅ With YAHOO MarketData: ${hasMarketData.length}`);
  console.log(`  ❌ Missing YAHOO MarketData: ${missingMarketData.length}`);

  if (missingMarketData.length > 0) {
    console.log('\n  Symbols missing YAHOO MarketData:');
    for (const p of missingMarketData) {
      console.log(`    - ${p.symbol}`);
    }
  }

  // 1e. Check for orphaned MANUAL MarketData (MANUAL rows whose SymbolProfile is now YAHOO)
  const orphanedManualRows = await prisma.$queryRaw<
    { symbol: string; rowCount: bigint }[]
  >`
    SELECT md.symbol, COUNT(*)::bigint AS "rowCount"
    FROM "MarketData" md
    WHERE md."dataSource" = 'MANUAL'
      AND NOT EXISTS (
        SELECT 1 FROM "SymbolProfile" sp
        WHERE sp.symbol = md.symbol AND sp."dataSource" = 'MANUAL'
      )
    GROUP BY md.symbol
    ORDER BY md.symbol
  `;

  console.log(
    `\nOrphaned MANUAL MarketData (no MANUAL SymbolProfile): ${orphanedManualRows.length} symbols`
  );
  if (orphanedManualRows.length > 0) {
    for (const row of orphanedManualRows) {
      console.log(
        `    - ${row.symbol}: ${Number(row.rowCount)} rows`
      );
    }
  }

  // 1f. Check for MANUAL MarketData that COULD be converted to YAHOO
  // (where a YAHOO SymbolProfile exists but the MarketData is still MANUAL)
  const convertibleRows = await prisma.$queryRaw<
    { symbol: string; rowCount: bigint }[]
  >`
    SELECT md.symbol, COUNT(*)::bigint AS "rowCount"
    FROM "MarketData" md
    WHERE md."dataSource" = 'MANUAL'
      AND EXISTS (
        SELECT 1 FROM "SymbolProfile" sp
        WHERE sp.symbol = md.symbol AND sp."dataSource" = 'YAHOO'
      )
    GROUP BY md.symbol
    ORDER BY md.symbol
  `;

  console.log(
    `\nConvertible MANUAL MarketData (YAHOO SymbolProfile exists): ${convertibleRows.length} symbols`
  );
  if (convertibleRows.length > 0) {
    let totalRows = 0;
    for (const row of convertibleRows) {
      const count = Number(row.rowCount);
      totalRows += count;
      console.log(`    - ${row.symbol}: ${count} rows`);
    }
    console.log(`    Total convertible rows: ${totalRows}`);
  }

  return { missingMarketData, convertibleRows, orphanedManualRows };
}

// ────────────────────────────────────────────────────────────────────
// Phase 2: Repair
// ────────────────────────────────────────────────────────────────────

async function repair(diagResult: {
  missingMarketData: { id: string; symbol: string }[];
  convertibleRows: { symbol: string; rowCount: bigint }[];
  orphanedManualRows: { symbol: string; rowCount: bigint }[];
}) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  PHASE 2 — REPAIR');
  console.log('═══════════════════════════════════════════════════\n');

  let convertedCount = 0;
  let fetchedCount = 0;
  let errorCount = 0;

  // ── Step 1: Convert orphaned/convertible MANUAL MarketData → YAHOO ──
  // For each symbol with MANUAL MarketData where a YAHOO SymbolProfile exists:
  //   - Try to update dataSource MANUAL→YAHOO
  //   - If unique constraint fails (YAHOO row already exists for that date),
  //     delete the MANUAL row instead (YAHOO takes priority)

  const allConvertibleSymbols = new Set([
    ...diagResult.convertibleRows.map((r) => r.symbol),
    ...diagResult.orphanedManualRows.map((r) => r.symbol)
  ]);

  // Filter to only those that actually have a YAHOO SymbolProfile
  const yahooProfiles = await prisma.symbolProfile.findMany({
    where: {
      dataSource: 'YAHOO',
      symbol: { in: Array.from(allConvertibleSymbols) }
    },
    select: { symbol: true }
  });
  const yahooSymbolSet = new Set(yahooProfiles.map((p) => p.symbol));

  for (const symbol of Array.from(allConvertibleSymbols)) {
    if (!yahooSymbolSet.has(symbol)) {
      console.log(`⏭  ${symbol}: No YAHOO SymbolProfile, skipping MANUAL MarketData`);
      continue;
    }

    try {
      // Get all MANUAL MarketData for this symbol
      const manualRows = await prisma.marketData.findMany({
        where: { dataSource: 'MANUAL', symbol },
        select: { id: true, date: true, marketPrice: true, state: true }
      });

      let converted = 0;
      let deleted = 0;

      for (const row of manualRows) {
        // Check if a YAHOO row already exists for this date+symbol
        const existing = await prisma.marketData.findUnique({
          where: {
            dataSource_date_symbol: {
              dataSource: 'YAHOO',
              date: row.date,
              symbol
            }
          }
        });

        if (existing) {
          // YAHOO row exists → delete the MANUAL duplicate
          await prisma.marketData.delete({ where: { id: row.id } });
          deleted++;
        } else {
          // No YAHOO row → convert MANUAL→YAHOO
          await prisma.marketData.update({
            where: { id: row.id },
            data: { dataSource: 'YAHOO' }
          });
          converted++;
        }
      }

      console.log(
        `✅ ${symbol}: converted ${converted} rows, deleted ${deleted} MANUAL duplicates`
      );
      convertedCount += converted;
    } catch (error) {
      console.error(
        `❌ ${symbol}: Convert failed — ${error instanceof Error ? error.message : error}`
      );
      errorCount++;
    }
  }

  // ── Step 2: Fetch missing MarketData from Yahoo Finance ──
  // For YAHOO SymbolProfiles with ZERO MarketData, backfill from Yahoo Finance API

  // Re-check which symbols still have no YAHOO MarketData after Step 1
  const symbolsToFetch: string[] = [];

  for (const profile of diagResult.missingMarketData) {
    const count = await prisma.marketData.count({
      where: { dataSource: 'YAHOO', symbol: profile.symbol }
    });

    if (count === 0) {
      symbolsToFetch.push(profile.symbol);
    }
  }

  if (symbolsToFetch.length > 0) {
    console.log(
      `\nFetching MarketData from Yahoo Finance for ${symbolsToFetch.length} symbols...`
    );

    let yahooFinance: any;
    try {
      yahooFinance = await getYahooFinance();
    } catch (e) {
      console.error(
        'Failed to load yahoo-finance2. Install it: npm install yahoo-finance2'
      );
      console.error(e);
      return { convertedCount, fetchedCount, errorCount };
    }

    const fromDate = subDays(resetHours(new Date()), 90); // 90 days of history
    const toDate = resetHours(new Date());

    for (const symbol of symbolsToFetch) {
      try {
        console.log(`  Fetching ${symbol}...`);

        const result = await yahooFinance.chart(symbol, {
          period1: formatDate(fromDate),
          period2: formatDate(toDate),
          interval: '1d'
        });

        if (
          !result ||
          !result.quotes ||
          result.quotes.length === 0
        ) {
          console.warn(`  ⚠️  ${symbol}: No data returned from Yahoo Finance`);
          continue;
        }

        const upsertOps = result.quotes
          .filter((q: any) => q.close != null && q.date != null)
          .map((q: any) => {
            const date = resetHours(new Date(q.date));
            return prisma.marketData.upsert({
              where: {
                dataSource_date_symbol: {
                  dataSource: 'YAHOO',
                  date,
                  symbol
                }
              },
              create: {
                dataSource: 'YAHOO',
                date,
                marketPrice: q.close,
                state: 'CLOSE',
                symbol
              },
              update: {
                marketPrice: q.close,
                state: 'CLOSE'
              }
            });
          });

        // Execute in batches of 50 to avoid overwhelming the DB
        for (let i = 0; i < upsertOps.length; i += 50) {
          const batch = upsertOps.slice(i, i + 50);
          await prisma.$transaction(batch);
        }

        console.log(`  ✅ ${symbol}: Inserted ${upsertOps.length} MarketData rows`);
        fetchedCount += upsertOps.length;
      } catch (error) {
        console.error(
          `  ❌ ${symbol}: Yahoo fetch failed — ${error instanceof Error ? error.message : error}`
        );
        errorCount++;
      }
    }
  } else {
    console.log('\nNo symbols need Yahoo Finance backfill after Step 1.');
  }

  return { convertedCount, fetchedCount, errorCount };
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║    MarketData Repair Script                      ║');
  console.log(`║    Mode: ${FIX_MODE ? '🔧 FIX (will modify data)' : '🔍 DRY RUN (diagnose only)'}        ║`);
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const diagResult = await diagnose();

  const needsRepair =
    diagResult.missingMarketData.length > 0 ||
    diagResult.convertibleRows.length > 0 ||
    diagResult.orphanedManualRows.length > 0;

  if (!needsRepair) {
    console.log('\n✅ All good! No repair needed.');
    return;
  }

  if (!FIX_MODE) {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  DRY RUN — No changes made.');
    console.log('  Run with --fix to apply repairs:');
    console.log('    npx ts-node --compiler-options \'{"module":"commonjs"}\' scripts/repair-market-data.ts --fix');
    console.log('══════════════════════════════════════════════════');
    return;
  }

  const result = await repair(diagResult);

  console.log('\n══════════════════════════════════════════════════');
  console.log('  REPAIR SUMMARY');
  console.log('══════════════════════════════════════════════════');
  console.log(`  MANUAL→YAHOO rows converted: ${result.convertedCount}`);
  console.log(`  Yahoo Finance rows fetched:   ${result.fetchedCount}`);
  console.log(`  Errors:                       ${result.errorCount}`);
  console.log('══════════════════════════════════════════════════');

  if (result.errorCount > 0) {
    console.log(
      '\n⚠️  Some errors occurred. The data gathering cron will attempt to fill remaining gaps.'
    );
    console.log(
      '   You can also trigger "Gather All" from the Ghostfolio admin panel.'
    );
  } else {
    console.log('\n✅ Repair complete! Portfolio should now load correctly.');
    console.log(
      '   Note: It may take a minute for caches to clear. Try a hard refresh (Ctrl+Shift+R).'
    );
  }
}

main()
  .catch((e) => {
    console.error('Repair script failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
