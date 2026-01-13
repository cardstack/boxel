#!/bin/sh

set -e

if [ -d contents ]; then
  exit 0
fi

if [ "$CATALOG_ENV" = "testing" ]; then
  git clone git@github.com:cardstack/boxel-catalog-testing.git contents || \
    git clone https://github.com/cardstack/boxel-catalog-testing.git contents
else
  git clone git@github.com:cardstack/boxel-catalog.git contents || \
    git clone https://github.com/cardstack/boxel-catalog.git contents
fi
