#!/bin/bash

# Script to copy files/directories while preserving extended attributes using rsync
# Usage: ./setup-files.sh [--delete] <source> <destination>

set -e

DELETE_FLAG=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --delete)
            DELETE_FLAG="--delete"
            shift
            ;;
        *)
            break
            ;;
    esac
done

if [ $# -ne 2 ]; then
    echo "Usage: $0 [--delete] <source> <destination>"
    echo "Copies source to destination preserving extended attributes using rsync"
    echo "  --delete: Remove files in destination that don't exist in source"
    exit 1
fi

SOURCE="$1"
DEST="$2"

if [ ! -e "$SOURCE" ]; then
    echo "Error: Source '$SOURCE' does not exist"
    exit 1
fi

# Create destination directory if it doesn't exist
mkdir -p "$DEST"

# Use rsync without extended attributes first
# -r: recursive
# --size-only: only copy if sizes differ (for efficiency)
rsync -r --size-only $DELETE_FLAG "$SOURCE/." "$DEST/"

# Set created attribute on new files that don't have it using TypeScript
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_NO_WARNINGS=1 ts-node --transpileOnly "$SCRIPT_DIR/set-created-attributes.ts" "$DEST"

echo "Successfully synced '$SOURCE' to '$DEST' and set created attributes on new files"