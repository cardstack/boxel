#!/bin/bash
set -e
# we use this to ignore all the DOM errors. add any new DOM errors to this regex
maybe_deprecations=$(pnpm glint 2>&1 | perl -p0e "s/[^\n]*Cannot find name '(HTMLElement|ShadowRoot|HTMLDialogElement|HTMLDivElement|HTMLButtonElement|HTMLAnchorElement|HTMLInputElement|HTMLTextAreaElement|HTMLElementTagNameMap|CSSStyleSheet|CSSStyleRule|Node|DocumentOrShadowRoot)'[^\n]*[\n]*[^\n]*[\n]*[^\n]*[\n]*//smg")
glint_output=$(echo "$maybe_deprecations" | perl -p0e "s/DeprecationWarning:[^\n]*[\n]*//smg")
echo "$maybe_deprecations"
if [ ${#glint_output} -gt 0 ]; then
  exit 1
else
  exit 0
fi
