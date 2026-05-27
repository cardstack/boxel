---
name: pr-monitor
allowed-tools: Read, Bash, Monitor
description: After opening a PR, arm a persistent background Monitor that watches it for new review comments and CI checks turning red, so the agent can react as feedback lands instead of after the whole run finishes. Offers a full form (also drafts per-thread replies to review feedback) and a reduced CI-only form for those who'd rather the agent not reply ahead of the human author. Use right after opening or updating a PR.
---

# PR Monitor

After a PR is opened, arm a **persistent `Monitor`** that polls GitHub and emits one event per new review comment and per CI check turning red. Each emitted line becomes a notification, so the agent can react to feedback and failures as they land rather than waiting for the whole CI run.

`gh pr create` is **not** the end of that thread of work — the end state is "PR filed AND monitor armed." Arm it as the next step after opening the PR.

## Pick a form — and read this first

Two behaviors are bundled in the full form: (a) reacting to CI failures, and (b) **drafting replies to human reviewers' comments**. Behavior (b) is the judgment call. The replies are posted through the PR author's GitHub account, but each one begins with the `[Claude Code 🤖]` prefix (see the `pr-comment-attribution` skill), so reviewers can see at a glance that the agent wrote it — not the author. The concern is therefore social, not mistaken identity: a teammate may simply not want an agent taking a first pass at reviewers' feedback before they've engaged with it themselves. Respect that.

- **Full form** — watches review comments + reviews + CI, and the agent drafts a per-thread reply to each (prefixed per the `pr-comment-attribution` skill so reviewers know it's the agent). Use when the PR author is comfortable with the agent taking a first pass at review feedback.
- **CI-only form** (reduced) — watches **only** CI checks turning red; review comments are left entirely to the human author. Use this when anyone is uncomfortable with the agent replying on their behalf. It still gives you the tight fix-CI-fast loop without touching the social surface.

When in doubt, default to the CI-only form and let the author opt up.

## CI-only form (reduced)

```sh
REPO="<owner>/<repo>"
PR=<number>
CHECKS_FILE="/tmp/<slug>-pr-monitor-checks.txt"
rm -f "$CHECKS_FILE"; touch "$CHECKS_FILE"

# Pre-seed currently-failing checks at the CURRENT head SHA only.
HEAD_SHA=$(gh -R "$REPO" pr view "$PR" --json headRefOid --jq '.headRefOid' 2>/dev/null || echo "")
[ -n "$HEAD_SHA" ] && gh pr checks -R "$REPO" "$PR" --json name,bucket \
  --jq '.[] | select(.bucket=="fail") | "check-fail|'"$HEAD_SHA"'|\(.name)"' 2>/dev/null >> "$CHECKS_FILE"
echo "Pre-seeded check-fails=$(wc -l < "$CHECKS_FILE") (head=$HEAD_SHA)"

while true; do
  state=$(gh -R "$REPO" pr view "$PR" --json state --jq '.state' 2>/dev/null || echo "")
  if [ "$state" = "MERGED" ] || [ "$state" = "CLOSED" ]; then echo "PR-$state"; exit 0; fi

  HEAD_SHA=$(gh -R "$REPO" pr view "$PR" --json headRefOid --jq '.headRefOid' 2>/dev/null || echo "")
  if [ -n "$HEAD_SHA" ]; then
    gh pr checks -R "$REPO" "$PR" --json name,bucket --jq '.[] | select(.bucket=="fail") | .name' 2>/dev/null \
    | while IFS= read -r name; do
        [ -z "$name" ] && continue
        key="check-fail|$HEAD_SHA|$name"
        if ! grep -qxF "$key" "$CHECKS_FILE"; then
          echo "$key" >> "$CHECKS_FILE"
          echo "[ci-fail] $name turned RED at ${HEAD_SHA:0:7}"
        fi
      done
  fi
  sleep 60
done
```

When a `[ci-fail]` event fires: pull the failing job's logs, diagnose, fix on the branch, push. The new SHA invalidates the old check states — don't wait for sibling still-running checks on the dead SHA.

## Full form (CI + review comments)

Adds the comment/review endpoints and a self-reply filter on top of the CI loop:

```sh
REPO="<owner>/<repo>"
PR=<number>
REPLY_MARKER="claude-<slug>-reply"           # invisible HTML-comment marker in every reply
SEEN_FILE="/tmp/<slug>-pr-monitor-seen.txt"
CHECKS_FILE="/tmp/<slug>-pr-monitor-checks.txt"
rm -f "$SEEN_FILE" "$CHECKS_FILE"; touch "$SEEN_FILE" "$CHECKS_FILE"

# Pre-seed existing comments/reviews so a restart doesn't flood the chat.
gh api --paginate "repos/$REPO/issues/$PR/comments" --jq '.[].id' 2>/dev/null | sed 's/^/issue-/' >> "$SEEN_FILE"
gh api --paginate "repos/$REPO/pulls/$PR/comments"  --jq '.[].id' 2>/dev/null | sed 's/^/review-comment-/' >> "$SEEN_FILE"
gh api --paginate "repos/$REPO/pulls/$PR/reviews"   --jq '.[].id' 2>/dev/null | sed 's/^/review-/' >> "$SEEN_FILE"
HEAD_SHA=$(gh -R "$REPO" pr view "$PR" --json headRefOid --jq '.headRefOid' 2>/dev/null || echo "")
[ -n "$HEAD_SHA" ] && gh pr checks -R "$REPO" "$PR" --json name,bucket \
  --jq '.[] | select(.bucket=="fail") | "check-fail|'"$HEAD_SHA"'|\(.name)"' 2>/dev/null >> "$CHECKS_FILE"
echo "Pre-seeded comments=$(wc -l < "$SEEN_FILE") check-fails=$(wc -l < "$CHECKS_FILE") (head=$HEAD_SHA)"

while true; do
  state=$(gh -R "$REPO" pr view "$PR" --json state --jq '.state' 2>/dev/null || echo "")
  if [ "$state" = "MERGED" ] || [ "$state" = "CLOSED" ]; then echo "PR-$state"; exit 0; fi

  {
    gh api --paginate "repos/$REPO/issues/$PR/comments" --jq '.[]
      | select(.body | contains("'"$REPLY_MARKER"'") | not)
      | "issue\t\(.id)\t\(.user.login)\t\(.html_url)\t\((.body // "") | gsub("\\s+"; " ") | .[0:160])"' 2>/dev/null
    gh api --paginate "repos/$REPO/pulls/$PR/comments" --jq '.[]
      | select(.body | contains("'"$REPLY_MARKER"'") | not)
      | "review-comment\t\(.id)\t\(.user.login)\t\(.html_url)\t\(.path):\(.line // .original_line // 0)\t\((.body // "") | gsub("\\s+"; " ") | .[0:160])"' 2>/dev/null
    gh api --paginate "repos/$REPO/pulls/$PR/reviews" --jq '.[]
      | select((.state=="APPROVED") or (.state=="CHANGES_REQUESTED") or (.state=="DISMISSED") or (.state=="COMMENTED" and (.body // "")!=""))
      | "review\t\(.id)\t\(.user.login)\t\(.html_url)\t\(.state)\t\((.body // "") | gsub("\\s+"; " ") | .[0:160])"' 2>/dev/null
  } | while IFS=$'\t' read -r kind id rest; do
    [ -z "$id" ] && continue
    key="${kind}-${id}"
    if ! grep -qxF "$key" "$SEEN_FILE"; then
      echo "$key" >> "$SEEN_FILE"
      echo "[$kind] $rest"
    fi
  done

  HEAD_SHA=$(gh -R "$REPO" pr view "$PR" --json headRefOid --jq '.headRefOid' 2>/dev/null || echo "")
  if [ -n "$HEAD_SHA" ]; then
    gh pr checks -R "$REPO" "$PR" --json name,bucket --jq '.[] | select(.bucket=="fail") | .name' 2>/dev/null \
    | while IFS= read -r name; do
        [ -z "$name" ] && continue
        key="check-fail|$HEAD_SHA|$name"
        if ! grep -qxF "$key" "$CHECKS_FILE"; then
          echo "$key" >> "$CHECKS_FILE"
          echo "[ci-fail] $name turned RED at ${HEAD_SHA:0:7}"
        fi
      done
  fi
  sleep 60
done
```

Arm via the `Monitor` tool with `persistent: true`. Replies go in their own thread via
`POST repos/<owner>/<repo>/pulls/<n>/comments/<id>/replies`, each beginning with the
`[Claude Code 🤖]` prefix (see the `pr-comment-attribution` skill) and ending with the
`<!-- claude-<slug>-reply -->` marker so the loop's filter skips the agent's own echoes.

## Gotchas (each one cost real time)

1. **Per-SHA dedup for CI, keyed `(name, head_sha)`.** A check that fails on push A, is fixed in B, breaks again in C is three notifications. The SHA in the key resets the dedup scope on every push — don't hand-roll a "still failing? keep : drop" cleanup loop.
2. **Use `|` in the dedup key, not `:`.** `IFS=':'` mis-splits names like `Host Tests (9, 20)`.
3. **The shell is zsh.** `for x in $var` does NOT split a string in zsh — it iterates once with the whole blob. For multiple PRs use a **literal list**: `for PR in 4891 4892; do …`, never `PRS="4891 4892"; for PR in $PRS`. (Want a variable? Use a zsh array: `prs=(4891 4892); for PR in "${prs[@]}"`.) The bug is silent: the monitor announces "Pre-seeded…" but queries `pulls/4891 4892/comments` and returns nothing.
4. **`gh api` has no `-R` flag.** Use positional `repos/<owner>/<repo>/…` paths. (`-R` is for `gh pr`/`gh issue`/`gh pr checks`.)
5. **Pre-seed before the loop**, or a restart emits every existing comment as new. For CI, pre-seed only the *current* head SHA's failures.
6. **Filter the agent's own replies by an HTML-comment marker, not by author** — replies post under the authenticated user, often the same account doing the reviewing.
7. **Three comment endpoints:** `issues/<n>/comments` (conversation), `pulls/<n>/comments` (inline, with file/line), `pulls/<n>/reviews` (summaries: APPROVED / CHANGES_REQUESTED / DISMISSED).
8. **Reply with the threaded endpoint** `pulls/<n>/comments/<id>/replies` — `pulls/<n>/comments` creates a new top-level comment instead of nesting.
9. **60s polling** is plenty; faster burns API rate limits with no gain.
10. **Empty-body `COMMENTED` reviews are the agent's own reply-wrappers.** Posting a threaded reply makes GitHub auto-create a parent `review` row with `state="COMMENTED"` and an empty body. The marker lives on the inline comment, not this wrapper, so filter empty-body COMMENTED reviews out at the `reviews` stage (the jq above already does).
11. **`gh pr checks` needs `-R "$REPO"`.** Unlike `gh api`, `gh pr checks` (and `gh pr view`) accept `-R`. Without it, `gh` resolves the PR from the current directory's repo/branch — so a monitor launched from anywhere else silently pre-seeds and polls the wrong PR. Pass `-R "$REPO"` on every `gh pr checks` / `gh pr view` call.
12. **Paginate the comment/review endpoints.** `gh api` returns only the first page (~30 items) by default. On a PR with many comments, feedback past page one never emits. Pass `--paginate` on every `issues/<n>/comments`, `pulls/<n>/comments`, and `pulls/<n>/reviews` call (pre-seed and poll).

## Re-arming after a broken window

The pre-seed step **silently absorbs** every comment that arrived while a monitor was down or broken — the fixed monitor announces "Pre-seeded comments=N" and never emits those N. Before re-arming a previously-broken monitor, manually read out `issues/<n>/comments`, `pulls/<n>/comments`, and `pulls/<n>/reviews` and address anything that landed in the gap. Bot reviewers (Codex, Copilot) often comment within seconds of a push, so the gap risk is highest right after opening.
