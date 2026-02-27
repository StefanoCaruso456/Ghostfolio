import { defineConfig } from '@prisma/config';
import { config } from 'dotenv';
import { expand } from 'dotenv-expand';
import { join } from 'node:path';

// Load .env file if present (local dev); Railway injects vars directly
expand(config({ quiet: true }));

// When a Prisma config file exists, Prisma 6 skips its own env loading.
// We must explicitly provide the datasource URL so the WASM schema
// validator can resolve env("DATABASE_URL") from the schema.
const databaseUrl = process.env.DATABASE_URL;

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
