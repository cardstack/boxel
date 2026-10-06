#!/usr/bin/env bash
# Starts boxel-catalog's "Deploy to production" at a catalog revision
# and waits for its result. Manual Deploy [boxel] to production runs this
# twice with the revision the deployed commit pins: before the release, which
# ships what the production boxel already runs, and after it, which ships the
# rest.
#
#   dispatch-catalog-deploy.sh <before-release|after-release> <revision>
#
# GH_TOKEN is the CATALOG_DEPLOY_DISPATCH_TOKEN secret, a fine-grained token
# with Actions read and write on cardstack/boxel-catalog. A missing or
# rejected token is an error in both phases. A token that expires within
# EXPIRY_WARNING_DAYS is a warning. The catalog run's own result is an error
# after the release, and only a notice before it: a catalog change that needs
# the new boxel refuses before the release by design, and the run after the
# release carries it.

set -euo pipefail

phase=$1
revision=$2
repo=cardstack/boxel-catalog
workflow=deploy-production.yml
runs="https://github.com/$repo/actions/workflows/$workflow"
EXPIRY_WARNING_DAYS=30

regenerate="Generate a new fine-grained token (GitHub, Settings, Developer settings, Fine-grained tokens: resource owner cardstack, only cardstack/boxel-catalog, Actions read and write), and save it as the CATALOG_DEPLOY_DISPATCH_TOKEN secret in cardstack/boxel."
by_hand="Until then, run \"Deploy to production\" with revision $revision by hand: $runs"

if [ -z "${GH_TOKEN:-}" ]; then
  echo "::error title=catalog deploy token::CATALOG_DEPLOY_DISPATCH_TOKEN is not set in cardstack/boxel, so the catalog wasn't deployed. $regenerate $by_hand"
  exit 1
fi

# A fine-grained token's expiry comes back on every response it signs.
headers=$(curl -sS -o /dev/null -D - \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$repo/actions/workflows/$workflow")
status=$(head -n1 <<<"$headers" | awk '{print $2}')
if [ "$status" = "401" ] || [ "$status" = "403" ]; then
  echo "::error title=catalog deploy token::GitHub rejected CATALOG_DEPLOY_DISPATCH_TOKEN ($status), so the catalog wasn't deployed. It has probably expired or been revoked. $regenerate $by_hand"
  exit 1
fi
expiry=$(grep -i '^github-authentication-token-expiration:' <<<"$headers" | cut -d: -f2- | tr -d '\r' | sed 's/^ *//' || true)
if [ -n "$expiry" ]; then
  days=$((($(date -d "$expiry" +%s) - $(date +%s)) / 86400))
  if [ "$days" -lt "$EXPIRY_WARNING_DAYS" ]; then
    echo "::warning title=catalog deploy token::CATALOG_DEPLOY_DISPATCH_TOKEN expires in $days days ($expiry). When it does, production deploys stop deploying the catalog. $regenerate"
  fi
fi

# A boxel change that merges before the catalog pull request fixing what it
# breaks pins that pull request's head. Merged with a merge commit, the head is
# on catalog main. Squashed or rebased, it never is, and the catalog deploy
# refuses a revision off main, so deploy that pull request's merge commit,
# which carries the same change.
on_main=$(gh api "repos/$repo/compare/$revision...main" --jq .status 2>/dev/null || true)
if [ "$on_main" != "ahead" ] && [ "$on_main" != "identical" ]; then
  # A failed request prints its error body, so only a successful one counts.
  if ! merged=$(gh api "repos/$repo/commits/$revision/pulls" \
    --jq "[.[] | select(.merged_at != null and .base.ref == \"main\" and .head.sha == \"$revision\")][0] // empty | \"\(.number) \(.merge_commit_sha)\"" 2>/dev/null); then
    merged=""
  fi
  if [ -n "$merged" ]; then
    read -r merged_pr merged_sha <<<"$merged"
    echo "::notice title=catalog deploy::$revision isn't on catalog main. It is the head of $repo#$merged_pr, which merged as $merged_sha, so this deploys $merged_sha."
    revision=$merged_sha
    by_hand="Until then, run \"Deploy to production\" with revision $revision by hand: $runs"
  fi
fi

# The catalog workflow's run name starts with the reason, so this run's marker
# finds the run it starts. GitHub cuts a long run name short in the API, so the
# marker leads.
marker="boxel $GITHUB_RUN_ID.$GITHUB_RUN_ATTEMPT $phase"
reason="$marker, lockstep with cardstack/boxel@${GITHUB_SHA:0:12}"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if ! out=$(gh workflow run "$workflow" --repo "$repo" --ref main \
  -f revision="$revision" -f reason="$reason" 2>&1); then
  echo "$out"
  if grep -qE 'HTTP 40[13]' <<<"$out"; then
    echo "::error title=catalog deploy token::GitHub refused CATALOG_DEPLOY_DISPATCH_TOKEN when starting the catalog deploy. It needs Actions read and write on cardstack/boxel-catalog. $regenerate $by_hand"
  else
    echo "::error title=catalog deploy::Couldn't start the catalog deploy. $by_hand"
  fi
  exit 1
fi

run_id=""
for _ in $(seq 1 24); do
  sleep 5
  run_id=$(gh api "repos/$repo/actions/workflows/$workflow/runs?event=workflow_dispatch&created=>=$started&per_page=20" \
    --jq "[.workflow_runs[] | select(.display_title | contains(\"$marker\"))][0].id // empty" 2>/dev/null || true)
  [ -n "$run_id" ] && break
done
if [ -z "$run_id" ]; then
  echo "::error title=catalog deploy::Started the catalog deploy, but couldn't find its run to wait for. Check it: $runs"
  exit 1
fi
url="https://github.com/$repo/actions/runs/$run_id"
echo "Waiting for the catalog deploy: $url"
echo "Catalog deploy ($phase) to $revision: $url" >> "$GITHUB_STEP_SUMMARY"

if gh run watch "$run_id" --repo "$repo" --exit-status --interval 30 >/dev/null; then
  echo "The catalog deploy finished: $url"
  exit 0
fi
if [ "$phase" = "before-release" ]; then
  echo "::notice title=catalog deploy::The catalog deploy before the release didn't deploy. Usually that's a catalog change that needs this boxel, and the deploy after the release carries it. Its run says which: $url"
  exit 0
fi
echo "::error title=catalog deploy::The catalog deploy failed or refused, so production runs this boxel against an older catalog. Its run names the catalog and boxel pull requests involved: $url"
exit 1
