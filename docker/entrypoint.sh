#!/bin/sh

set -ex

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
