#!/bin/sh

set -ex

# Validate database URL is available before attempting migrations
if [ -z "$DATABASE_URL" ] && [ -z "$DATABASE_PRIVATE_URL" ] && [ -z "$DATABASE_PUBLIC_URL" ] && [ -z "$POSTGRES_URL" ]; then
  echo "ERROR: No database URL found in environment."
  echo "Set DATABASE_URL (or DATABASE_PRIVATE_URL / POSTGRES_URL) in your Railway Variables tab."
  echo "Skipping migrations and starting server anyway..."
  exec node main
fi

# Use the first available URL for Prisma CLI commands
export DATABASE_URL="${DATABASE_URL:-${DATABASE_PRIVATE_URL:-${DATABASE_PUBLIC_URL:-$POSTGRES_URL}}}"

if [ "${PRISMA_MIGRATE_ON_STARTUP:-true}" = "true" ]; then
  echo "Running database migrations"
  npx prisma migrate deploy
else
  echo "Skipping database migrations (PRISMA_MIGRATE_ON_STARTUP=${PRISMA_MIGRATE_ON_STARTUP})"
fi

if [ "${PRISMA_SEED_ON_STARTUP:-true}" = "true" ]; then
  echo "Seeding the database"
  npx prisma db seed
else
  echo "Skipping database seed (PRISMA_SEED_ON_STARTUP=${PRISMA_SEED_ON_STARTUP})"
fi

echo "Starting the server"
exec node main
