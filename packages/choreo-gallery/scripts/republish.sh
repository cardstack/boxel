#!/usr/bin/env bash
# Republishes the production gallery realm to choreo.boxel.site, so the hosted
# copy matches what the realm holds now. Manual Deploy [boxel] runs it after
# every production release (through republish-choreo-gallery.yml), and anyone
# signed in as choreo_gallery_writer can run it by hand:
#
#   boxel profile add --user @choreo_gallery_writer:boxel.ai
#   packages/choreo-gallery/scripts/republish.sh
#
# It needs the Boxel CLI on PATH, with the active profile signed in as an
# account that can write the realm. A writer can publish only because the
# realm server's PUBLISHED_REALM_DOMAIN_OVERRIDES maps the realm to its site's
# domain; without that entry the realm server requires realm-owner and refuses
# the publish. Staging's realm publishes to choreo.staging.boxel.build under
# its own entry: set SOURCE_REALM_URL and PUBLISHED_REALM_URL to republish it.
#
# 1. A deploy copies the realm onto disk as the realm server starts, and the
#    realm then indexes the files that changed. The publishability check reads
#    that index, and the publish request waits for it, so wait here first,
#    where the wait is visible and bounded, until the realm reports ready.
# 2. Publish. The CLI refuses when the realm has publishability violations
#    (a private dependency, or a card that fails to index), then waits until
#    the published copy's HTML is rendered. --no-republish stops it from
#    unpublishing the site and retrying when the server answers 400 or 409, so
#    a failed republish leaves the previous copy serving.
#
# Overrides: SOURCE_REALM_URL, PUBLISHED_REALM_URL, INDEX_WAIT_MINUTES (how long
# to wait for the realm's index, default 120) and PUBLISH_WAIT_MINUTES (how
# long to wait for the published copy to be ready, default 60).

set -euo pipefail

source_realm=${SOURCE_REALM_URL:-https://app.boxel.ai/choreo-gallery/}
published_realm=${PUBLISHED_REALM_URL:-https://choreo.boxel.site/}
index_wait_minutes=${INDEX_WAIT_MINUTES:-120}
publish_wait_minutes=${PUBLISH_WAIT_MINUTES:-60}

deadline=$(($(date +%s) + index_wait_minutes * 60))
while true; do
  # The readiness check holds a request open while it waits on the index, so
  # give each poll its own time limit.
  headers=$(curl -sS -o /dev/null -D - --max-time 60 \
    -H 'Accept: application/vnd.api+json' \
    "${source_realm}_readiness-check" || true)
  status=$(head -n1 <<<"$headers" | awk '{print $2}')
  if [ "$status" = "200" ]; then
    echo "$source_realm is indexed"
    break
  fi
  stage=$(grep -i '^x-boxel-not-ready:' <<<"$headers" | cut -d: -f2- | tr -d '\r ' || true)
  # The realm stays index-failed until it is indexed again, so waiting won't
  # help.
  if [ "$stage" = "index-failed" ]; then
    echo "::error title=Choreo gallery not republished::$source_realm failed to index, so $published_realm still serves its previous copy. Run this script again once the realm has been reindexed."
    exit 1
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error title=Choreo gallery not republished::$source_realm was still not ready after $index_wait_minutes minutes (HTTP ${status:-none}${stage:+, not ready: $stage}), so $published_realm still serves its previous copy. Run this script again once the realm is ready."
    exit 1
  fi
  echo "waiting for $source_realm to index (HTTP ${status:-none}${stage:+, not ready: $stage})"
  sleep 30
done

boxel realm publish "$source_realm" "$published_realm" \
  --no-republish \
  --timeout $((publish_wait_minutes * 60 * 1000))
