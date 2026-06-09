#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SOURCE_POSTGRES_URL:-}" || -z "${TARGET_POSTGRES_URL:-}" ]]; then
  echo "SOURCE_POSTGRES_URL and TARGET_POSTGRES_URL are required." >&2
  exit 1
fi

dump_file="${POSTGRES_DUMP_FILE:-/tmp/podsum-postgres-$(date +%Y%m%d%H%M%S).dump}"

pg_dump "$SOURCE_POSTGRES_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$dump_file"

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$TARGET_POSTGRES_URL" \
  "$dump_file"

echo "Postgres migration restored into target database: $dump_file"
