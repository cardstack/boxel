#!/bin/sh

if [ -z "$1" ]; then
  echo "Usage: $0 <directory>"
  exit 1
fi

search_dir="$1"

background_base_url="https://boxel-images.boxel.ai/background-images/"
icon_base_url="https://boxel-images.boxel.ai/icons/"

find "$search_dir" -type f -name "*.realm.json" | while read json_file; do
  echo "Processing $json_file..."

  jq --arg background_base_url "$background_base_url" \
    --arg icon_base_url "$icon_base_url" \
    '
       # For the backgroundURL, preserve the last part of the URL and add the new base URL
       .backgroundURL |= ($background_base_url + (. | capture(".*/(?<file>[^/]+)$").file)) |
       
       # For the iconURL, preserve the last part of the URL and add the new base URL
       .iconURL |= ($icon_base_url + (. | capture(".*/(?<file>[^/]+)$").file))
       ' \
    "$json_file" >tmp.$$.json && mv tmp.$$.json "$json_file"

  echo "$json_file updated."
done
