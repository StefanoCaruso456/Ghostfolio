import { defineConfig } from '@prisma/config';
import { config } from 'dotenv';
import { expand } from 'dotenv-expand';
import { join } from 'node:path';

// Load .env file if present (local dev); Railway injects vars directly
expand(config({ quiet: true }));

// When a Prisma config file exists, Prisma 6 skips its own env loading.
// We must explicitly provide the datasource URL so the WASM schema
// validator can resolve env("DATABASE_URL") from the schema.
//
// Railway may expose the database URL under different variable names
// depending on how the PostgreSQL service is linked.
const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.DATABASE_PRIVATE_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  process.env.POSTGRES_URL;

if (!databaseUrl) {
  console.error(
    '[prisma.ts] WARNING: No database URL found in environment. ' +
      'Checked: DATABASE_URL, DATABASE_PRIVATE_URL, DATABASE_PUBLIC_URL, POSTGRES_URL. ' +
      'Ensure one of these is set in your Railway Variables tab.'
  );
}

export default defineConfig({
  ...(databaseUrl
    ? {
        engine: 'classic' as const,
        datasource: { url: databaseUrl }
      }
    : {}),
  migrations: {
    path: join(__dirname, '..', 'prisma', 'migrations'),
    seed: `node ${join(__dirname, '..', 'prisma', 'seed.mts')}`
  },
  schema: join(__dirname, '..', 'prisma', 'schema.prisma')
});
