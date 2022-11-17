#!/bin/bash
set -e
# we use this to ignore all the DOM errors. add any new DOM errors to this regex
glint_output=$(pnpm glint 2>&1 | sed -z "s/[^\n]*Cannot find name '\(HTMLElement\|ShadowRoot\|HTMLInputElement\|CSSStyleSheet\|CSSStyleRule\|Node\|DocumentOrShadowRoot\)'[^\n]*\n\n[^\n]*\n[^\n]*\n\n//g")
echo "$glint_output"
if [ ${#glint_output} -gt 0 ]; then
  exit 1
else
  exit 0
fi
