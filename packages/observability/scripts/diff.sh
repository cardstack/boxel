#!/usr/bin/env bash
# diff.sh — Show the diff between this package's committed
# `grafanactl/resources/` state and the live state of a target Grafana
# environment. Used by CS-10933's PR comment workflow + ad-hoc by humans
# wanting a preview before a `./scripts/apply.sh` push.
#
# Usage:
#   ./scripts/diff.sh [--env local|staging|production]
#                     [--only-changed-since <git-ref>]
#
# Flags:
#   --env                  Target Grafana environment to compare against
#                          (default: staging).
#   --only-changed-since   Restrict the diff to dashboards / folders whose
#                          files changed in
#                          `git diff --name-only <ref>...HEAD --diff-filter=ACMRT`
#                          under `packages/observability/grafanactl/resources/`.
#                          Used by the PR comment workflow so the diff
#                          reflects what the PR actually changes (vs total
#                          drift between staging and main). Deletions are
#                          excluded since `grafanactl push` is upsert-only —
#                          deletion-only PRs short-circuit to empty stdout.
#                          When the filter set is empty (no PR-relevant
#                          changes) the script exits 0 with no output before
#                          calling `grafanactl pull`.
#
# Output: human-readable diff on stdout. Empty output (and exit 0) means
# the committed state matches the live state, or — when
# --only-changed-since is set — that the PR didn't change any
# grafanactl-managed resources.
#
# Scope: this only diffs the resources grafanactl manages — dashboards
# and folders. The `provisioning/` tree (data sources, alert rules) is
# delivered to Grafana via file mount at startup, not via API push, so
# there's no live "current state" to diff against from the outside. PR
# review of those YAMLs is the only check.
#
# CS-10933 chose this "Path B" implementation because grafanactl has
# no native `diff` subcommand — confirmed by `grafanactl resources --help`.
set -eo pipefail

usage_error() { echo "error: $1" >&2; exit 2; }

env_name=staging
only_changed_since=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "missing value for --env"
      env_name="$2"
      shift 2
      ;;
    --env=*)
      env_name="${1#--env=}"
      [[ -n "$env_name" ]] || usage_error "missing value for --env"
      shift
      ;;
    # When set, restrict the diff to dashboards/folders whose files
    # changed in `git diff --name-only <ref>...HEAD` under
    # `packages/observability/grafanactl/resources/`. Used by the PR
    # comment workflow so the diff reflects what THIS PR would do to
    # staging on apply, rather than total drift between staging and
    # main (which can be large and unrelated to the PR).
    #
    # If no PR-relevant paths changed, the diff is empty and the script
    # exits 0 immediately (skipping the live pull).
    --only-changed-since)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "missing value for --only-changed-since"
      only_changed_since="$2"
      shift 2
      ;;
    --only-changed-since=*)
      only_changed_since="${1#--only-changed-since=}"
      [[ -n "$only_changed_since" ]] || usage_error "missing value for --only-changed-since"
      shift
      ;;
    *)
      usage_error "unknown option: $1"
      ;;
  esac
done

cd "$(dirname "$0")/.."

# Build the changed-paths filter list BEFORE the expensive grafanactl
# pull, so a no-op PR exits without touching staging. Stored as a
# newline-separated string (instead of an associative array) for bash
# 3.2 compatibility — same constraint the rest of this script honors.
# Each line is a path relative to repo root (e.g.,
# `packages/observability/grafanactl/resources/dashboards/.../foo.json`)
# so it matches `git diff --name-only` output directly.
filter_paths=""
if [[ -n "$only_changed_since" ]]; then
  # Validate the ref up front so a missing/invalid ref produces a clear
  # error rather than a noisy `git diff` failure further down. CI usually
  # passes `origin/<base-ref>` and we'd rather surface "this ref isn't
  # available locally" with actionable guidance than git's bare
  # "fatal: bad revision" exiting under set -e.
  if ! git rev-parse --verify --quiet "${only_changed_since}^{commit}" >/dev/null; then
    echo "error: --only-changed-since=$only_changed_since does not resolve to a commit." \
         "In CI, ensure the workflow does \`git fetch origin <base-ref>\` (or" \
         "\`actions/checkout\` with \`fetch-depth: 0\`) before invoking diff.sh." >&2
    exit 1
  fi
  # `--diff-filter=ACMRT` — Added / Copied / Modified / Renamed / Type-changed.
  # Exclude Deleted because `grafanactl push` is upsert-only and never
  # deletes; a deletion in the PR is a no-op for live state. Without
  # this, a PR that only deletes a dashboard would skip the empty-set
  # short-circuit below and trigger a needless `grafanactl pull`.
  #
  # `git -C <repo-root>` so the path filter and output paths are both
  # repo-rooted, regardless of where the script was invoked from. The
  # CI workflow runs us with `working-directory: packages/observability`,
  # which combined with the `cd "$(dirname "$0")/.."` above leaves
  # `$PWD` at `packages/observability` — and from there git would
  # interpret `-- packages/observability/grafanactl/resources/` as a
  # CWD-relative pathspec (i.e., `packages/observability/packages/observability/...`),
  # which never matches anything and silently returns an empty set,
  # short-circuiting every observability PR to a blank diff comment.
  # `is_in_filter_rel` below also expects repo-rooted paths in the
  # `filter_paths` strings, so this fix keeps both sides aligned.
  filter_paths="$(git -C "$(git rev-parse --show-toplevel)" \
    diff --name-only --diff-filter=ACMRT \
    "${only_changed_since}...HEAD" \
    -- packages/observability/grafanactl/resources/)"
  if [[ -z "$filter_paths" ]]; then
    # Empty stdout signals "no diff" to the workflow's comment step,
    # which renders the "No dashboard / folder changes detected"
    # comment body.
    exit 0
  fi
fi

# Returns 0 (success) if a path under grafanactl/resources/ should be
# included in the diff. Always returns 0 when the filter is inactive —
# preserving the original "diff everything" behavior.
#   $1 — path relative to grafanactl/resources/ (e.g.
#        `dashboards/boxel-status/foo.json`).
is_in_filter_rel() {
  [[ -z "$filter_paths" ]] && return 0
  local key="packages/observability/grafanactl/resources/$1"
  local line
  while IFS= read -r line; do
    [[ "$line" == "$key" ]] && return 0
  done <<< "$filter_paths"
  return 1
}

# shellcheck source=./grafanactl-env.sh
source ./scripts/grafanactl-env.sh "$env_name"

# Mirror apply.sh's per-env REALM_SERVER_URL handling so the
# `__REALM_SERVER_URL__` placeholder substitution below produces the
# same value diff.sh expects to find in the live (pulled) state. CI
# sources REALM_SERVER_URL from SSM in observability-diff.yml; locally
# we default to apply.sh's hardcoded https://localhost:4201/. For
# staging/production ad-hoc runs, the operator must export the same
# value apply.sh uses (CI fetches it from /<env>/boxel-grafana/realm_server_url
# — see observability-apply-${env_name}.yml).
#
# `grafana_secret` (CS-10929) is intentionally NOT mirrored from
# GRAFANA_SECRET. apply.sh substitutes the real secret, so the live
# (pulled) state of every dashboard's `grafana_secret` constant template
# variable carries the real value. If we substituted the same real value
# on the committed side, a) any rotation drift between SSM and live
# Grafana would surface in the diff (i.e., the diff would print the old
# AND new secret), and b) the substituted value can appear in `git diff`
# context lines when nearby panels change. Both leak into the PR comment
# diff.sh's output is rendered into. Instead we redact both sides to a
# fixed placeholder before diffing — see the `grafana_secret` arm of
# JQ_NORMALIZE below.
case "$env_name" in
  local) realm_server_url="${REALM_SERVER_URL:-https://localhost:4201/}" ;;
  *)
    [[ -n "${REALM_SERVER_URL:-}" ]] \
      || { echo "error: REALM_SERVER_URL not set; CI fetches it from /${env_name}/boxel-grafana/realm_server_url in observability-diff.yml — for a local hosted run, export it manually first (same SSM path apply-${env_name}.yml uses)" >&2; exit 1; }
    realm_server_url="$REALM_SERVER_URL"
    ;;
esac

cfg="$(./scripts/render-config.sh "$env_name")"
remote="$(mktemp -d -t grafanactl-pull.XXXXXX)"
remote_norm="$(mktemp -d -t grafanactl-norm.XXXXXX)"
remote_canon="$(mktemp -d -t remote-canon.XXXXXX)"
committed_canon="$(mktemp -d -t committed-canon.XXXXXX)"
trap 'rm -rf "$cfg" "$remote" "$remote_norm" "$remote_canon" "$committed_canon"' EXIT

# Pull what's currently live into the tempdir. We pass explicit kind
# arguments (`dashboards folders`) instead of letting grafanactl
# enumerate everything because the default scan would also try to list
# `plugins.grafana.app` (the service-account token doesn't have
# permission — 403) and `features.grafana.app/noop` (404, doesn't exist
# on the Grafana version we run). Both warnings would fail the pull
# even though we don't actually want those kinds for the diff.
#
# Suppress stdout so the user sees only the diff at the end; stderr
# (errors) still surface.
grafanactl \
  --config "$cfg" \
  --context "$env_name" \
  resources pull \
  dashboards folders \
  --path "$remote" \
  >/dev/null

# Normalize the pulled tree so it has the same layout as the committed
# tree, matching by UID. Two reasons:
#
#   1. grafanactl pull writes `<remote>/Dashboard/<uid>.json` (and
#      `<remote>/Folder/<uid>.json`); the committed tree groups
#      dashboards under a folder name. Without normalization,
#      `git diff --no-index` would render every file as a full add+
#      delete pair even when the dashboard is unchanged.
#   2. `grafanactl resources push` is upsert-only — it does NOT delete
#      live resources missing from our manifest set. Pulled files with
#      no committed counterpart (UI-created dashboards, AMG-era
#      artefacts) would otherwise show as "deleted file" in the diff,
#      suggesting an action that doesn't actually happen.
#
# So: for each committed file, look up the matching pulled file by UID
# (`metadata.name` in the App Platform schema, falling back to legacy
# spec.uid) and copy it to the same relative path inside $remote_norm.
# Pulled files without a committed counterpart get dropped silently.
# Committed files without a pulled counterpart leave their slot empty
# in $remote_norm so the diff renders them as "new file" (apply would
# create).
extract_uid() {  # $1: path to a committed manifest
  jq -r '.metadata.name // .spec.uid // .uid // empty' "$1"
}

normalize() {  # $1: subdir under grafanactl/resources, $2: pulled-kind dirname
  local subdir="$1" kind="$2"
  # `find -print0` + a NUL-delimited read loop rather than a `**/*.json` glob —
  # macOS's default bash 3.2 doesn't support `shopt -s globstar` and `set -eo`
  # would abort diff.sh before it could produce output. Portable across
  # bash 3.2 / 4.x / 5.x and zsh.
  local committed uid pulled rel target
  while IFS= read -r -d '' committed; do
    uid="$(extract_uid "$committed")"
    [[ -n "$uid" ]] || continue
    pulled="${remote}/${kind}/${uid}.json"
    [[ -f "$pulled" ]] || continue
    rel="${committed#./grafanactl/resources/}"
    is_in_filter_rel "$rel" || continue
    target="${remote_norm}/${rel}"
    mkdir -p "$(dirname "$target")"
    cp "$pulled" "$target"
  done < <(find "./grafanactl/resources/${subdir}" -type f -name '*.json' -print0 2>/dev/null)
}

normalize dashboards Dashboard
normalize folders Folder

# Normalize JSON content (CS-10988 + CS-10990 + CS-10991). Without
# this, `git diff` surfaces several classes of noise that have nothing
# to do with what an apply would actually change:
#
#   1. Unicode-escape style. The committed JSON encodes `&` as the
#      6-byte escape sequence `&` and `>` as `>` (an artefact
#      of CS-10922's original extract pipeline). `jq` decodes both back
#      to literal `&` and `>` on re-emit, while the live API returns
#      them already decoded. Every URL / query-string with `&` becomes
#      a diff line. Re-emitting both sides through `jq` collapses them.
#   2. App Platform server-injected metadata. Pulled state has
#      `metadata.id` (server-assigned int), an empty `metadata.labels`,
#      `metadata.namespace: "default"`, and may grow
#      resourceVersion/creationTimestamp/uid. Our committed JSON omits
#      all of these because they don't round-trip on push. Note:
#      `metadata.uid` is the App Platform's server-assigned UUID — a
#      Kubernetes-style resource id, distinct from `metadata.name`
#      (the user-facing identifier we ship in committed JSON). Stripping
#      it cannot hide a real diff.
#   3. Key order inside `metadata`. `--sort-keys` makes order stable on
#      both sides.
#   4. `__REALM_SERVER_URL__` placeholder (CS-10923 / CS-10990). apply.sh
#      walks the committed JSON and substitutes the per-env realm-server
#      URL into the `realm_server` constant template variable's `query`
#      before pushing. Pulled state therefore always shows the substituted
#      value. We mirror the same walk here so the committed side ends up
#      with the same value pre-diff. The match is GUARDED by
#      `.query == "__REALM_SERVER_URL__"` so the substitution only
#      rewrites the committed side; the pulled side always carries the
#      live URL (never the placeholder), so real drift between
#      $REALM_SERVER_URL and what's actually provisioned in Grafana
#      surfaces in the diff.
#   4b. `grafana_secret` redaction (CS-10929). apply.sh substitutes the
#      realm-server shared secret into the `grafana_secret` constant
#      template variable's `query` at push time. The live (pulled) state
#      therefore carries the real secret, and a rotation in SSM that
#      hasn't been re-applied would show the old secret in the diff
#      output — which the diff.yml workflow renders into a PR comment
#      (no Actions log masking on PR comment bodies). To keep diff.sh
#      from leaking credentials, redact both sides to a fixed placeholder
#      ("REDACTED") whenever a `grafana_secret` constant template
#      variable is encountered, regardless of its current `.query` value.
#      That covers the committed side (where `.query` is still
#      "REPLACE_AT_APPLY_TIME") and the pulled side (where it's the
#      substituted real secret) with one walk arm.
#   5. Default `"value": null` on threshold step zero (CS-10991). Grafana
#      fills in `value: null` on the lowest threshold step (the implicit
#      `-Infinity` floor) when it stores a dashboard. AMG-era exports
#      and humans omit the key. The match is scoped to objects that
#      look like a thresholds container (`mode` + `steps`) at index 0
#      so a `value: null` higher up the steps array (a malformed
#      threshold worth surfacing) still shows in the diff.
# shellcheck disable=SC2016  # `$url` is a jq variable bound via --arg, not a shell expansion.
JQ_NORMALIZE='
  walk(
    if type == "object"
       and .name? == "realm_server"
       and .type? == "constant"
       and .query? == "__REALM_SERVER_URL__"
    then
      .query = $url
      | (if .current then .current.value = $url | .current.text = $url else . end)
    elif type == "object"
       and .name? == "grafana_secret"
       and .type? == "constant"
    then
      # Redact both sides — see the long comment under "Normalize JSON
      # content" above for why this is unconditional rather than guarded.
      .query = "REDACTED"
      | (if .current then .current.value = "REDACTED" | .current.text = "REDACTED" else . end)
    else . end
  )
  | walk(
      if type == "object"
         and has("mode")
         and (.steps? | type) == "array"
         and (.steps | length) > 0
         and (.steps[0] | type) == "object"
         and (.steps[0] | has("value"))
         and (.steps[0].value == null)
      then
        .steps[0] |= del(.value)
      else . end
    )
  | (if type == "object" and has("metadata") and (.metadata | type) == "object" then
      .metadata |= (
        del(.id)
        | del(.resourceVersion)
        | del(.creationTimestamp)
        | del(.uid)
        | (if has("labels") and (.labels | type) == "object" and (.labels | length) == 0 then del(.labels) else . end)
        | (if has("annotations") and (.annotations | type) == "object" and (.annotations | length) == 0 then del(.annotations) else . end)
        | (if .namespace == "default" then del(.namespace) else . end)
      )
    else . end)
'

normalize_json_content() {  # $1: src dir, $2: dest dir
  local src="$1" dest="$2"
  # `find -print0` + a NUL-delimited read loop rather than `**/*.json` —
  # macOS's default bash 3.2 doesn't support `shopt -s globstar`, and
  # enabling shell options inside a function leaks them back to the
  # caller anyway. This pattern is portable across bash 3.2 / 4.x / 5.x
  # and zsh and has no shell-state side effects.
  local f rel target
  while IFS= read -r -d '' f; do
    rel="${f#"$src"/}"
    is_in_filter_rel "$rel" || continue
    target="$dest/$rel"
    mkdir -p "$(dirname "$target")"
    jq --sort-keys --arg url "$realm_server_url" "$JQ_NORMALIZE" "$f" > "$target"
  done < <(find "$src" -type f -name '*.json' -print0)
}

# Re-process both trees through jq into matching canonicalized layouts.
# Output goes into separate temp dirs (remote_canon / committed_canon)
# rather than overwriting the layout-normalized inputs, so a debugger
# inspecting the temp tree can see each step independently.
normalize_json_content "$remote_norm" "$remote_canon"
normalize_json_content "./grafanactl/resources" "$committed_canon"

# Diff: <remote-current-state, canonicalized> → <committed-target,
# canonicalized>. Reading top-to-bottom shows what would CHANGE on apply.
# Pulled resources that aren't in our committed set are deliberately
# absent from remote_canon (the layout-normalize step in `normalize`
# drops them from remote_norm, and remote_canon is just remote_norm
# re-canonicalized — push won't touch them).
#
# Color is disabled because the diff is consumed by GitHub Actions or
# piped to a PR comment (terminal escapes don't render in either).
#
# Exit codes from `git diff --no-index`:
#   0 — files identical (committed == live)
#   1 — files differ — the diff IS the output, treat as success here
#   2+ — real error (unreadable paths, internal git error, etc.) — propagate
set +e
git diff \
  --no-index \
  --no-color \
  "$remote_canon" \
  "$committed_canon"
diff_exit=$?
set -e

if [[ "$diff_exit" -gt 1 ]]; then
  echo "git diff --no-index exited with $diff_exit (real error, not just a diff)" >&2
  exit "$diff_exit"
fi
