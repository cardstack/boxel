# shellcheck shell=bash
# Tables that make up an index cache. This is the single source of truth: the
# same list drives pg_dump's -t args in scripts/dump-index-cache.sh and the
# host-scoped dump in mise-tasks/ci/cache-index, and the completeness check in
# scripts/verify-index-cache.sh (via the sidecar each dump writes). Keep the
# TRUNCATE lists in scripts/import-cached-index.sh and
# .devcontainer/claude-web-import-index.sh in sync — both replay these
# snapshots, and a table a replay does not clear first collides with the
# incoming COPY on its primary key. The *_pending tables are deliberately
# excluded — they are transient UNLOGGED scratch space.
#
# `scoped_css` holds the stylesheet bytes that the dumped rows' hashed
# scoped-CSS deps resolve to. Without it a consumer replays rows whose deps
# name hashes nothing in its database holds, and every request the realm
# serves under `_scoped-css/` answers 404 — which renders search results
# unstyled rather than failing, so nothing goes red. It carries `realm_url`,
# so the host-scoped dump's realm filter applies to it unchanged.
CACHE_TABLES=(boxel_index prerendered_html realm_generations realm_meta scoped_css)
