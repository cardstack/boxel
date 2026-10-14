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
  while IFS= read -r env_file; do
    copy_from_root "${env_file#"$ROOT_PATH"/}"
  done < <(find "$ROOT_PATH" \( -name node_modules -o -name .git -o -name realms -o -name contents \) -prune \
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

# boxel-icons is consumed through its `dist` exports, which install does not
# build; without it the host build fails on unresolved icon imports. Building
# takes a couple of minutes, so each build is cached under the git tree hash
# of the package's committed sources and reused by every workspace whose
# sources hash the same. Uncommitted edits to the package bypass the cache.
ICONS=packages/boxel-icons
ICONS_TREE="$(git rev-parse "HEAD:$ICONS")"
ICONS_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/boxel-superset/boxel-icons/$ICONS_TREE"
if [ ! -d "$ICONS/dist" ]; then
  if [ -d "$ICONS_CACHE/dist" ] && git diff --quiet HEAD -- "$ICONS"; then
    cp -a "$ICONS_CACHE/dist" "$ICONS/dist"
    log "copied cached $ICONS/dist ($ICONS_TREE)"
  else
    log "building boxel-icons"
    mise exec -- pnpm --filter @cardstack/boxel-icons build
    if git diff --quiet HEAD -- "$ICONS"; then
      mkdir -p "$ICONS_CACHE"
      rm -rf "$ICONS_CACHE/dist.tmp"
      cp -a "$ICONS/dist" "$ICONS_CACHE/dist.tmp"
      mv -T "$ICONS_CACHE/dist.tmp" "$ICONS_CACHE/dist" 2>/dev/null || rm -rf "$ICONS_CACHE/dist.tmp"
      # Keep the three most recent builds.
      ls -1dt "$(dirname "$ICONS_CACHE")"/*/ | tail -n +4 | xargs -r rm -rf
    fi
  fi
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
