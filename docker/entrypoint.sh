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

echo "Running database migrations"
npx prisma migrate deploy

echo "Seeding the database"
npx prisma db seed

echo "Starting the server"
exec node main
