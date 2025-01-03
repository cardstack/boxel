#!/bin/sh
SOURCE=$1
DEST=$2

RSYNC_OPTS="--delete --size-only --recursive"

mkdir -p "$DEST"
rsync --dry-run --itemize-changes $RSYNC_OPTS "$SOURCE/." "$DEST/"
rsync $RSYNC_OPTS "$SOURCE/." "$DEST/" 