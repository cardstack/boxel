#! /bin/sh

set -e

SUBMISSION_REALM_PATH="$1"

if [ -z "$SUBMISSION_REALM_PATH" ]; then
  echo "Usage: $0 <submission-realm-path>" >&2
  exit 1
fi

mkdir -p "$SUBMISSION_REALM_PATH"
if [ ! -f "$SUBMISSION_REALM_PATH/.realm.json" ]; then
  cat > "$SUBMISSION_REALM_PATH/.realm.json" << 'EOF'
{
  "name": "Submissions",
  "backgroundURL": "https://boxel-images.boxel.ai/background-images/background-for-catalog-82x.jpg",
  "iconURL": "https://boxel-images.boxel.ai/icons/Letter-s.png",
  "showAsCatalog": false,
  "publishable": false
}
EOF
fi
if [ ! -f "$SUBMISSION_REALM_PATH/index.json" ]; then
  cat > "$SUBMISSION_REALM_PATH/index.json" << 'EOF'
{
  "data": {
    "type": "card",
    "meta": {
      "adoptsFrom": {
        "module": "https://cardstack.com/base/cards-grid",
        "name": "CardsGrid"
      }
    }
  }
}
EOF
fi
