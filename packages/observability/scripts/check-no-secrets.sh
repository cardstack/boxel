#!/usr/bin/env bash
# check-no-secrets.sh — Fail if any committed file under this package
# contains a credential-shaped string. Wired into a GitHub Actions
# workflow (.github/workflows/observability-check.yml) and intended to
# be runnable locally for the same exit semantics.
#
# Usage:
#   ./scripts/check-no-secrets.sh
#
# Exit 0 when nothing matches, 1 with grep output when something does.
#
# Why this lives in the observability package and not at the repo root:
# the patterns we care about here (Grafana auth-in-querystring, baked
# data-source passwords, hard-coded Bearer tokens) are specific to
# Grafana resource files. Running these patterns repo-wide would catch
# things like "password" in test fixtures, doc strings, etc., and we'd
# spend our time tuning allowlists instead of catching real misuses.
#
# History: CS-10924 stripped `?authHeader=${grafana_secret}` from every
# operator-action URL in the dashboards (reindex / full-reindex /
# complete-job / add-credit / upsert-realm-user-permission). This
# script is the regression guard so that pattern can't sneak back.

set -eo pipefail

cd "$(dirname "$0")/.."

# Patterns + descriptions, in parallel arrays so the regexes can contain
# colons (POSIX character classes like `[[:space:]]`) without breaking
# a single-string `name:regex` parser.
#
# Pattern design notes:
# - `authHeader=` — the specific anti-pattern CS-10924 removed. Zero
#   tolerance: we don't want this to come back even gated on a Grafana
#   variable, because the pattern leaks the auth token through URL bars,
#   browser history, copy/paste, and screenshots once Grafana expands it
#   client-side.
# - `Bearer <long token>` — match Bearer followed by 30+ token-shaped
#   chars to avoid hitting placeholders like `Bearer <token>` or
#   `Bearer ${...}`.
# - `AKIA[A-Z0-9]{16}` — AWS access key ID prefix, fixed format.
# - `password[:=] ... 8+ non-placeholder chars` — excludes `${VAR}`
#   substitutions, `<value>` placeholders, empty strings, whitespace.
# - `api[_-]?key[:=] ... 16+ non-placeholder chars` — same shape; longer
#   minimum because API keys are typically longer than passwords.
PATTERN_REGEXES=(
  'authHeader='
  '[Bb]earer [A-Za-z0-9._/+=-]{30,}'
  'AKIA[A-Z0-9]{16}'
  'password[[:space:]]*[:=][[:space:]]*["'"'"']?[^$<[:space:]"'"'"']{8,}'
  'api[_-]?key[[:space:]]*[:=][[:space:]]*["'"'"']?[^$<[:space:]"'"'"']{16,}'
)
PATTERN_DESCS=(
  'authHeader= (Grafana auth-in-querystring; superseded by CS-10929 button panels — POST + Authorization: Bearer header)'
  'long Bearer token'
  'AWS access key ID'
  'literal password value'
  'literal API key value'
)

# Per-line allowlist. Lines matching any allowlist regex are excluded
# from secret-scan results. Add narrowly-scoped entries here when the
# scanner is wrong; never broaden to "anything in tests/" or similar.
ALLOWLIST=(
  # Grafana variable interpolations and Bash/YAML template placeholders
  # are by design — the actual value lives in SSM and gets substituted
  # at apply time, never in git.
  '\$\{[A-Za-z_][A-Za-z0-9_]*\}'
  # Comments and rationale fields that mention these patterns by name
  # for documentation purposes (this script's own comments, README
  # callouts, etc.). Match a leading `#`, `//`, or markdown-list `-`.
  '^[[:space:]]*(#|//|-|\*)'
  # JSON keys that contain the word "password"/"api_key"/"secret" but
  # whose values are placeholders or empty strings — e.g. the
  # secureJsonData scaffolding pattern.
  '"password":[[:space:]]*"\$\{[^}]+\}"'
  '"password":[[:space:]]*""'
)

# Scope: everything under this package, but skip generated/temp files
# and the script itself (its pattern table would always match).
FIND_ROOT="."
EXCLUDE_DIRS=(
  "./node_modules"
  "./dist"
  "./.tmp"
)

# Build a `find` invocation that prunes excluded dirs, then filters to
# the file types we care about. We intentionally cast a wide net (any
# text file) so future YAML / TS / Markdown additions are covered, and
# rely on the allowlist + comment-prefix filter to drop noise.
prune_args=()
for d in "${EXCLUDE_DIRS[@]}"; do
  prune_args+=(-path "$d" -prune -o)
done

# Compose ALLOWLIST into one OR'd ERE.
allowlist_re="$(IFS='|'; echo "${ALLOWLIST[*]}")"

violations=0
violation_buf=""

# Walk files. We can't use `git ls-files` because the script must work
# during a fresh CI checkout where the package may be the only thing
# being inspected and we want to flag uncommitted local edits too when
# run by hand.
while IFS= read -r -d '' file; do
  # Skip self.
  [[ "$file" == *"check-no-secrets.sh" ]] && continue
  # Skip binary files quickly.
  if file -b --mime "$file" 2>/dev/null | grep -q 'charset=binary'; then
    continue
  fi
  for i in "${!PATTERN_REGEXES[@]}"; do
    pat="${PATTERN_REGEXES[$i]}"
    desc="${PATTERN_DESCS[$i]}"
    # Use grep -nE for ERE + line numbers; -I skips binary. We then
    # re-filter by the allowlist.
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      # `line` is "<lineno>:<text>".
      text="${line#*:}"
      # Apply allowlist.
      if grep -Eq "$allowlist_re" <<<"$text"; then
        continue
      fi
      violations=$((violations + 1))
      violation_buf+="${file}:${line%%:*}: [${desc}] ${text}"$'\n'
    done < <(grep -nIE -- "$pat" "$file" 2>/dev/null || true)
  done
done < <(find "$FIND_ROOT" "${prune_args[@]}" -type f -print0)

if [[ $violations -gt 0 ]]; then
  echo "check-no-secrets: found $violations potential secret-shaped strings:" >&2
  printf '%s' "$violation_buf" >&2
  echo "" >&2
  echo "If this is a false positive, narrow the ALLOWLIST in scripts/check-no-secrets.sh." >&2
  echo "If this is real, remove the value and source it from SSM via apply-time substitution." >&2
  exit 1
fi

echo "check-no-secrets: no credential-shaped strings found in $(pwd)"
