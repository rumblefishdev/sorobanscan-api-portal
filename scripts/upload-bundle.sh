#!/usr/bin/env bash
# Builds the hub's bundle for production and copies it to the bucket the explorer's CloudFront
# serves `/api/` from, under `api/`. Nothing in the bucket is deleted: the old Prices portal's
# files, and the assets of earlier builds that a page loaded before a deploy still asks for, stay.
#
#   AWS_PROFILE=stellar scripts/upload-bundle.sh [--dryrun]
#
# `--dryrun` is passed to both `aws s3 sync` calls and uploads nothing. The AWS profile is the
# caller's `AWS_PROFILE`.
set -euo pipefail

BUCKET="s3://production-soroban-explorer-api-spa/api/"
IMMUTABLE="public, max-age=31536000, immutable"
REVALIDATE="public, max-age=0, must-revalidate"

dryrun=()
case "${1:-}" in
  "") ;;
  --dryrun) dryrun=(--dryrun) ;;
  *) echo "usage: $0 [--dryrun]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

VITE_PRODUCTS=prices,x402 VITE_PORTAL_API_ORIGIN=https://prices-api.sorobanscan.com pnpm build

if [ ! -f dist/index.html ]; then
  echo "dist/index.html is missing: the build did not produce the bundle" >&2
  exit 1
fi
# The x402 page's old address must not be in the bundle: its host, x402-facilitator.sorobanscan.com,
# legitimately is, so the check is for the address on sorobanscan.com.
if grep -rl "/api/x402-facilitator" dist; then
  echo "dist names /api/x402-facilitator: a link still goes to the page that is gone" >&2
  exit 1
fi

# Hashed files, safe to cache for good.
aws s3 sync dist/assets/ "${BUCKET}assets/" ${dryrun[@]+"${dryrun[@]}"} --cache-control "$IMMUTABLE"
# Everything else (index.html, the OpenAPI documents, the favicons), checked on every load.
aws s3 sync dist/ "$BUCKET" ${dryrun[@]+"${dryrun[@]}"} --exclude "assets/*" --cache-control "$REVALIDATE"
