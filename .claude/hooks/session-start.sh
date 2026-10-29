#!/bin/bash
# SessionStart hook. Two jobs:
#
# 1. Say which of the plugins .claude/settings.json enables this machine
#    lacks. A project-level `enabledPlugins` entry turns a plugin on but
#    doesn't fetch one whose marketplace entry has an external source, which
#    `boxel-skills` has; the /plugin Errors tab is the only place that shows
#    it, and until someone installs it a review of a UI change runs without
#    its guidelines lens. So the session is told at start, with the command,
#    and asks the user. The hook doesn't install anything itself: a plugin is
#    code the user runs, so the install is theirs to confirm. A plugin already
#    in installed_plugins.json costs one grep.
#
# 2. For "Claude Code on the web" sessions: when the realm-index cache is
#    absent, teach the session how to fetch it BEFORE starting the stack, so
#    the realm-server boots from a seconds-long SQL restore instead of a
#    multi-minute live prerender indexing (see
#    .devcontainer/claude-web-import-index.sh).
#
# The fetch cannot live in a provisioning script: the artifact's signed
# download URL comes from api.github.com, which this VM's network proxy
# blocks — only the session's GitHub MCP integration can call it. The signed
# URL it returns (Azure blob storage) IS directly fetchable. So the best a
# hook can do is put the playbook in front of the session, which is exactly
# what stdout of a SessionStart hook does (it is injected as context).
#
# Silent (no context cost) outside the remote VM or when the cache is already
# in place.
set -euo pipefail

PLUGINS_DIR="${CLAUDE_CODE_PLUGIN_CACHE_DIR:-$HOME/.claude/plugins}"
INSTALLED="$PLUGINS_DIR/installed_plugins.json"
missing=()
for plugin in interfaces@interfaces boxel-skills@cardstack-boxel; do
  if ! grep -qs "\"$plugin\"" "$INSTALLED"; then
    missing+=("$plugin")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  cat <<EOF
[boxel-plugins] This machine lacks plugins .claude/settings.json enables:
${missing[*]}. A project setting enables a plugin but doesn't fetch it. Before
any other work, ask the user to run, for each one:
  claude plugin install <plugin> --scope local
then /reload-plugins. Until then a review of a UI change runs without that
lens, and its opening sentence has to say which lens skill wasn't reviewed.
EOF
fi

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

CACHE_FILE="${BOXEL_INDEX_CACHE_FILE:-$HOME/.local/share/boxel/index-cache/boxel-index-cache.sql.gz}"
if [ -f "$CACHE_FILE" ]; then
  exit 0
fi

cat <<EOF
[boxel-stack] The realm-index cache is not present at $CACHE_FILE.
If asked to run the Boxel stack in this session, fetch the cache FIRST so the
stack boots in seconds instead of live-indexing every realm:

1. Using the GitHub MCP Actions tools against cardstack/boxel:
   a. actions_list method=list_workflow_runs resource_id=ci.yaml
      (filter: branch=main, status=completed; pass per_page=2 — each run
      object is ~40 KB, so larger pages overflow the MCP tool-result limit)
      -> take the newest run whose conclusion is "success" and note its run
      id; if neither run on the first page succeeded, page forward.
   b. actions_list method=list_workflow_run_artifacts resource_id=<run id>
      -> find the artifact named "boxel-index-cache" and note its artifact id.
   c. actions_get method=download_workflow_run_artifact
      resource_id=<artifact id> -> returns a signed, short-lived download_url.
2. Download and unpack it (the signed URL is directly fetchable; only
   api.github.com itself is blocked in this VM — do not try gh or raw API
   calls from the shell):
     mkdir -p "\$(dirname "$CACHE_FILE")"
     curl -sSL -o /tmp/boxel-index-cache.zip '<download_url>'
     unzip -o /tmp/boxel-index-cache.zip -d "\$(dirname "$CACHE_FILE")"
3. Start the stack: .devcontainer/claude-web-start.sh
   (its import step finds the cache at the path above automatically).
   The stack is ready when
     curl -sk -H 'Accept: application/vnd.api+json' \\
       https://localhost:4201/base/_readiness-check
   returns 200. The Accept header is required — without it (curl's default
   Accept: */*) the endpoint 404s even on a fully booted stack, which looks
   like a hung boot. Readiness is per-realm (the realm-server logs the list
   of realms it serves at boot); the bare / and /_readiness-check paths 404
   by design.

If the fetch fails, just run .devcontainer/claude-web-start.sh anyway — the
stack falls back to live indexing, which is slower but works.
EOF
