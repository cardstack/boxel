#! /bin/sh
set -x

CURRENT_DIR="$(pwd)"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

SRC_DIR="${SCRIPTS_DIR}/../src"
DIST_DIR="${SCRIPTS_DIR}/../dist"

if [ ! -d "$DIST_DIR" ]; then
  echo "boxel-ui/addon dist dir does not exist. Building in ${SRC_DIR}/.."
  cd "${SRC_DIR}/.."
  pnpm run build
  exit 0
fi
if [ "$(uname)" = "Darwin" ]; then
  mod_time_src=$(find "$SRC_DIR" -type f -exec stat -f %m {} + | sort -nr | head -n1)
  mod_time_dist=$(find "$DIST_DIR" -type f -exec stat -f %m {} + | sort -nr | head -n1)
else
  mod_time_src=$(find "$SRC_DIR" -type f -printf "%T@\n" | sort -nr | head -n1 | cut -d. -f1)
  mod_time_dist=$(find "$DIST_DIR" -type f -printf "%T@\n" | sort -nr | head -n1 | cut -d. -f1)
fi

if [ "$mod_time_src" -gt "$mod_time_dist" ]; then
  echo "boxel-ui/addon dist dir is out of date. Building in ${SRC_DIR}/.."
  cd "${SRC_DIR}/.."
  pnpm run build
else
  echo "✔️ boxel-ui/addon dist dir is up to date"
fi
