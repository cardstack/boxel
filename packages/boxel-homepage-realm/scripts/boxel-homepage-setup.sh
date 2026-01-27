#!/bin/sh

if [ -d contents ]; then
  exit 0
fi

if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
  git clone https://github.com/cardstack/boxel-home.git contents
else
  git clone git@github.com:cardstack/boxel-home.git contents || \
    git clone https://github.com/cardstack/boxel-home.git contents
fi
