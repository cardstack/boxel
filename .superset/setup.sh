#!/usr/bin/env bash
# Superset workspace setup: brings a fresh worktree to the point where
# `mise run dev-all`, lint, glint and the host/realm-server tests can run.
# Safe to re-run; every step skips work that is already done.
set -euo pipefail

. "$(cd "$(dirname "$0")" && pwd)/lib.sh"
cd "$WORKSPACE_PATH"

log "workspace: $WORKSPACE_PATH"
log "root checkout: $ROOT_PATH"
log "environment slug: $BOXEL_ENVIRONMENT"

# A fresh worktree's .mise.toml is untrusted, and mise silently does nothing
# for it until it is trusted.
mise trust --quiet "$WORKSPACE_PATH/.mise.toml"
mise install --quiet

# Untracked files the main checkout holds that a worktree needs: local agent
# settings, and any env files. Copied only when absent, so a workspace's own
# edits survive a re-run.
copy_from_root() {
  local rel="$1"
  if [ -e "$ROOT_PATH/$rel" ] && [ ! -e "$WORKSPACE_PATH/$rel" ]; then
    mkdir -p "$(dirname "$WORKSPACE_PATH/$rel")"
    cp -a "$ROOT_PATH/$rel" "$WORKSPACE_PATH/$rel"
    log "copied $rel"
  fi
}

if ! is_root_checkout; then
  copy_from_root .claude/settings.local.json
  copy_from_root packages/software-factory/.claude/settings.local.json
  # Worktrees nested in the root checkout (`.claude/worktrees`) hold their
  # own env files, which are not the root checkout's to hand on.
  while IFS= read -r env_file; do
    copy_from_root "${env_file#"$ROOT_PATH"/}"
  done < <(find "$ROOT_PATH" \( -name node_modules -o -name .git -o -name realms -o -name contents \
    -o -path "$ROOT_PATH/.claude/worktrees" \) -prune \
    -o -type f \( -name '.env' -o -name '.env.*' \) ! -name '.env.example' ! -name '.env.sample' -print 2>/dev/null)

  # Realm content the dev realm-server serves comes from separate repositories
  # (boxel-catalog, boxel-skills, boxel-home), cloned on first start. A local
  # copy of the main checkout's clones is much faster than cloning the catalog
  # over the network, and the realm-server pulls each one up to date when it
  # starts.
  copy_from_root packages/catalog/contents
  copy_from_root packages/skills-realm/contents
  copy_from_root packages/boxel-homepage-realm/contents
fi

log "installing dependencies"
mise exec -- pnpm install --frozen-lockfile

# boxel-icons is consumed through its built `dist` (code) and `declarations`
# (types), which install does not produce; without them the host build and
# type checks fail on unresolved icon imports. Building takes a couple of
# minutes, so each build is cached under the git tree hash of the package's
# committed sources and reused by every workspace whose sources hash the same.
# A package with uncommitted or untracked changes is built and never cached.
ICONS=packages/boxel-icons
ICONS_TREE="$(git rev-parse "HEAD:$ICONS")"
ICONS_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/boxel-superset/boxel-icons"
ICONS_CACHE="$ICONS_CACHE_ROOT/$ICONS_TREE"
# Written once this workspace holds a complete build of this tree, so output
# left by an interrupted build or copy is redone rather than trusted.
ICONS_DONE="$STATE_DIR/boxel-icons-$ICONS_TREE"
icons_pristine() {
  [ -z "$(git status --porcelain -- "$ICONS")" ]
}
icons_cache_complete() {
  [ -d "$ICONS_CACHE/dist" ] && [ -d "$ICONS_CACHE/declarations" ]
}
if [ ! -f "$ICONS_DONE" ]; then
  rm -rf "$ICONS/dist" "$ICONS/declarations"
  if icons_cache_complete && icons_pristine; then
    cp -a "$ICONS_CACHE/dist" "$ICONS_CACHE/declarations" "$ICONS/"
    log "copied cached boxel-icons build ($ICONS_TREE)"
  else
    log "building boxel-icons"
    mise exec -- pnpm --filter @cardstack/boxel-icons build
    if icons_pristine; then
      # Each writer fills a private directory and publishes it with one
      # rename, so a concurrent setup never sees a half-written entry. When
      # another setup has published the same tree first, this copy is dropped.
      mkdir -p "$ICONS_CACHE_ROOT"
      ICONS_TMP="$(mktemp -d "$ICONS_CACHE_ROOT/.tmp.XXXXXX")"
      cp -a "$ICONS/dist" "$ICONS/declarations" "$ICONS_TMP/"
      if [ -e "$ICONS_CACHE" ] && ! icons_cache_complete; then
        rm -rf "$ICONS_CACHE"
      fi
      if [ -e "$ICONS_CACHE" ] || ! mv "$ICONS_TMP" "$ICONS_CACHE" 2>/dev/null; then
        rm -rf "$ICONS_TMP"
      fi
      # A rename that raced another writer's lands inside its entry instead.
      rm -rf "$ICONS_CACHE/$(basename "$ICONS_TMP")"
      # Keep the three most recent builds.
      ls -1dt "$ICONS_CACHE_ROOT"/*/ | tail -n +4 | while IFS= read -r stale; do
        rm -rf "$stale"
      done
    fi
  fi
  touch "$ICONS_DONE"
fi

case "$WORKSPACE_PATH" in
  */.*)
    # A dot segment anywhere in the path (Superset's default is
    # ~/.superset/worktrees) breaks two dev loops that match paths with
    # dotfiles excluded: boxel-ui's rollup build, whose keepAssets glob skips
    # the scoped CSS, and `ember test --path dist`, whose static server
    # refuses every file.
    log "WARNING: this workspace's path has a dot segment ($WORKSPACE_PATH)."
    log "  boxel-ui builds and host 'ember test --path dist' runs fail under such a path."
    log "  Point Superset elsewhere: superset settings set worktreeBaseDir <dot-free dir>"
    ;;
esac

log "setup complete. Press Run to start the dev stack at https://host.${BOXEL_ENVIRONMENT}.localhost"
