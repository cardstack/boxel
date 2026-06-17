#!/usr/bin/env bash
#
# Symbolize a prerender wedge from its V8 `--prof` artifact.
#
# When a render times out with PRERENDER_V8_PROF=true, the prerender server
# ships the pegged isolate's raw V8 `--prof` log to the prerender artifacts
# bucket as a `.v8log` object, keyed env/realm/jobId/card/step/<ts>.v8log (see
# packages/realm-server/prerender/v8-prof.ts and the indexing-diagnostics
# skill, Mode I). The raw log is too large to `--prof-process` in-container
# under the render-timeout budget; this script fetches it and symbolizes it
# offline, where there's no deadline.
#
# The log self-contains its `code-creation` records, so `node --prof-process`
# resolves the JS frames from the file alone — no binaries or source maps.
# Native/Chrome frames stay opaque (that needs Chrome debug symbols); the JS
# layer is what names the wedge. The 60s peg dominates the cumulative log, so
# the top [JavaScript] self-time frame and heaviest [Bottom up] path are it.
#
# Requires an aws-access session for the env (`mise run claude-aws <env> <mfa>`)
# — the boxel-claude-readonly role has s3:GetObject/ListBucket on
# boxel-prerender-artifacts-*. And `node` on PATH.
#
# Usage:
#   symbolize-prerender-wedge.sh --realm bxl-dependency-order-test
#   symbolize-prerender-wedge.sh --env staging --realm ctse/foo --top 80
#   symbolize-prerender-wedge.sh --key staging/<realm>/<job>/<card>/<step>/<ts>.v8log
#   symbolize-prerender-wedge.sh --realm bxl --list        # just list candidates
set -euo pipefail

ENV=staging
REALM=
PROFILE=
KEY=
TOP=50
LIST_ONLY=

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    --realm) REALM="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --top) TOP="$2"; shift 2 ;;
    --list) LIST_ONLY=1; shift ;;
    -h | --help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

PROFILE="${PROFILE:-claude-$ENV}"
BUCKET="boxel-prerender-artifacts-$ENV"
AWS=(aws --profile "$PROFILE" --region "${AWS_REGION:-us-east-1}")

command -v node >/dev/null || { echo "node not found on PATH" >&2; exit 127; }

# Resolve the artifact key: newest `.v8log` whose key matches the realm
# substring (artifacts auto-expire after 14 days, so the listing stays small).
if [[ -z "$KEY" ]]; then
  [[ -n "$REALM" ]] || { echo "need --realm <substring> or --key <s3-key>" >&2; exit 2; }
  echo "Listing .v8log artifacts in s3://$BUCKET (realm ~ '$REALM') ..." >&2
  mapfile -t MATCHES < <(
    "${AWS[@]}" s3api list-objects-v2 --bucket "$BUCKET" --prefix "$ENV/" \
      --query "reverse(sort_by(Contents[?ends_with(Key, '.v8log')], &LastModified))[].Key" \
      --output text 2>/dev/null | tr '\t' '\n' | grep -iF -- "$REALM" || true
  )
  [[ ${#MATCHES[@]} -gt 0 ]] || { echo "no .v8log artifact for realm '$REALM' in $BUCKET" >&2; exit 1; }
  if [[ -n "$LIST_ONLY" ]]; then printf '%s\n' "${MATCHES[@]}"; exit 0; fi
  KEY="${MATCHES[0]}"
fi

echo "Artifact: s3://$BUCKET/$KEY" >&2
TMP="$(mktemp "${TMPDIR:-/tmp}/wedge-XXXXXX.v8log")"
trap 'rm -f "$TMP"' EXIT
"${AWS[@]}" s3 cp "s3://$BUCKET/$KEY" "$TMP" >&2
echo "Downloaded $(( $(wc -c < "$TMP") / 1024 / 1024 ))MB; running node --prof-process ..." >&2
echo >&2

node --prof-process "$TMP" 2>/dev/null | sed -n \
  "/\[Summary\]/,+16p; /\[JavaScript\]/,+${TOP}p; /\[Bottom up (heavy) profile\]/,+${TOP}p"
