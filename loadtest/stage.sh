#!/usr/bin/env bash
# One concurrency stage across all five endpoints, then a production health gate.
#
#   VERCEL_BYPASS=... PREVIEW=https://<preview-host> PRODUCTION=https://<prod-host> \
#     ./loadtest/stage.sh <connections> <requests-per-endpoint>
#
# Stops at the first non-zero exit from a run (including any 403) and does not
# continue to the next endpoint. The production gate sends three plain GETs.
set -u
export MSYS_NO_PATHCONV=1
here="loadtest"  # run from the repository root
c="$1"; n="$2"
: "${PREVIEW:?set PREVIEW}"; : "${PRODUCTION:?set PRODUCTION}"

node "$here/run.mjs" "$PREVIEW" /                                           --connections "$c" --amount "$n" --duration 40 --label "home" || exit $?
node "$here/run.mjs" "$PREVIEW" /collections/all                            --connections "$c" --amount "$n" --duration 40 --label "collection" || exit $?
node "$here/run.mjs" "$PREVIEW" /products/northbound-creatine-monohydrate   --connections "$c" --amount "$n" --duration 40 --label "product" || exit $?
node "$here/run.mjs" "$PREVIEW" /status                                     --connections "$c" --amount "$n" --duration 40 --label "status" || exit $?
node "$here/run.mjs" "$PREVIEW" /api/vitals --vitals                        --connections "$c" --amount "$n" --duration 40 --label "vitals (invalid body)" || exit $?
node "$here/health.mjs" "$PRODUCTION"
