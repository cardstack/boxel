#!/bin/sh
#
# Walk each realm directory under the given path and create a realm.json
# RealmConfig card instance next to its legacy .realm.json sidecar. The
# card is seeded with cardInfo.name / backgroundURL / iconURL pulled from
# the sidecar; the sidecar itself is left in place (it still owns
# publishable / hostHome / interactHome / showAsCatalog until later
# tickets retire those fields).
#
# Idempotent: directories that already have a realm.json are skipped.

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <realms-root-directory>"
  exit 1
fi

search_dir="$1"

find "$search_dir" -type f -name ".realm.json" | while read sidecar_file; do
  realm_dir=$(dirname "$sidecar_file")
  card_file="$realm_dir/realm.json"

  if [ -f "$card_file" ]; then
    echo "Skipping $realm_dir (realm.json already exists)"
    continue
  fi

  echo "Migrating $realm_dir"

  jq -n --slurpfile sidecar "$sidecar_file" '
    ($sidecar[0]) as $s |
    {
      data: {
        type: "card",
        attributes: (
          {} +
          (if $s.name then { cardInfo: { name: $s.name } } else {} end) +
          (if $s.backgroundURL then { backgroundURL: $s.backgroundURL } else {} end) +
          (if $s.iconURL then { iconURL: $s.iconURL } else {} end)
        ),
        meta: {
          adoptsFrom: {
            module: "https://cardstack.com/base/realm-config",
            name: "RealmConfig"
          }
        }
      }
    }
  ' >"$card_file"

  echo "  wrote $card_file"
done
