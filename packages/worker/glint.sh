#!/bin/bash
set -e
# we use this to ignore all the DOM errors. add any new DOM errors to this regex
glint_output=$(pnpm glint 2>&1 | tr "\n" "\r" | sed -z "s/[^\r]*Cannot find name '\(HTMLElement\|ShadowRoot\|HTMLInputElement\|CSSStyleSheet\|CSSStyleRule\|Node\|DocumentOrShadowRoot\)'[^\r]*\r\r[^\r]*\r[^\r]*\r\r//g" | tr "\r" "\n")
echo "$glint_output"
if [ ${#glint_output} -gt 0 ]; then
  exit 1
else
  exit 0
fi
