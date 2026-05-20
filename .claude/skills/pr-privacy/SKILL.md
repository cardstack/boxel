---
name: pr-privacy
description: Redact user data before publishing anything to GitHub. This repo is open source, so PR titles, PR descriptions, PR review comments, PR review replies, issue comments on PRs, commit messages, and committed file content are all public forever and indexed by search engines. Use this skill whenever you are about to call `gh pr create`, `gh pr comment`, `gh pr review`, `gh issue comment`, or any `mcp__github__*` tool that posts content (create_pull_request, add_comment_to_pending_review, add_issue_comment, pull_request_review_write, update_pull_request, etc.), and whenever you are about to write a commit message or check in a file that quotes data observed from production or staging — CloudWatch logs, the boxel_index database, EFS filesystem listings, realm metadata, Matrix room state, or a user's browser. Linear (tickets, comments, attachments) is staff-only and exempt; full detail belongs there.
allowed-tools: Read, Grep, Bash(gh pr view *, gh pr diff *)
---

# PR Privacy: Don't Leak User Data into Public GitHub Surfaces

The boxel repo is open source. Anything that lands on github.com/cardstack/boxel — PR titles, descriptions, review comments, review replies, issue comments on PRs, commit messages, and committed files — is public, permanent, and indexed by search engines. Quoting raw data observed in production or staging into any of those surfaces leaks user information.

Linear is the right home for unredacted detail. Link to a Linear ticket from the PR and put concrete identifiers there.

## What counts as user data

Treat any of the following as user data that must be redacted before it touches a public GitHub surface:

- **Realm URLs and slugs.** A realm URL looks like `<username>/<realm-slug>/`. The first path segment is a real Matrix username; the second is a realm name the user chose. Both identify the user. Example shape (do not use real values): `<username>/<realm-slug>/`.
- **Card paths under a user realm.** Anything past the realm root in a user realm — directory names, card filenames, UUIDs in card filenames, embedded field type names visible in the path. These often reflect what the user is working on.
- **User-authored content.** Card titles, descriptions, body text, field values quoted from a card document.
- **Matrix handles, room IDs that map to user DMs, and email addresses.**
- **Account IDs that map to a specific person**, including Matrix user IDs (`@handle:matrix.boxel.ai`).
- **Screenshots that incidentally show any of the above** in the address bar, breadcrumbs, sidebar, or card body.

## What is OK to keep verbatim

- **Job IDs and other opaque integers** that don't map to a person (`job 209668`, internal queue IDs).
- **System realms that ship publicly** — base realm, skills realm, catalog realm, experiments realm. Their slugs are part of the platform.
- **Infra identifiers** — ECS task names, CloudWatch log group names, RDS instance names, EFS paths like `/persistent/`.
- **Synthesized or generic examples** — `user1/test-realm/example.json`, `alice/demo/card-1.json`. Make it obviously fake.
- **Numbers in aggregate** — "3 affected cards across 3 user realms", "p95 latency 800ms", row counts, byte sizes.

## How to redact

Preserve the *shape* of the data so the reviewer can still reason about it, drop the identifying parts:

- Replace path segments with placeholders that describe the role: `<username>/<realm>/<card-type>/<card>.json`.
- Replace lists of concrete examples with a count plus opaque IDs: instead of three full URLs, write "3 affected cards across 3 user realms (job IDs 209668, 209743, 209962)".
- Crop or blur screenshots before attaching them. Check the browser address bar, breadcrumb trail, sidebar realm list, and any visible card titles.
- For log excerpts, replace user realm URLs with `<user-realm>` and keep the structural fields (timestamps, request IDs, status codes, durations).

If a reviewer genuinely needs the concrete identifiers to reproduce a bug, write "see <Linear-ticket-id> for affected realm slugs" in the PR and put the unredacted list in the Linear ticket. Linear is staff-only and is the right place for that detail.

## Surfaces this rule applies to

Public — REDACT before posting:

- `gh pr create` — title and body
- `gh pr comment`, `gh pr review`, `gh pr review --comment`, review replies
- `gh issue comment` (when the issue is on a public repo)
- `mcp__github__create_pull_request`, `mcp__github__update_pull_request`
- `mcp__github__add_comment_to_pending_review`, `mcp__github__add_reply_to_pull_request_comment`, `mcp__github__pull_request_review_write`
- `mcp__github__add_issue_comment`, `mcp__github__issue_write`
- Commit messages (also public on GitHub once pushed)
- File content you check in — test fixtures, documentation, code comments, snapshot files

Staff-only — OK to include full detail:

- Linear tickets, comments, attachments, status updates (via `mcp__linear__*`)
- Local terminal output the user sees in their own session
- Notes in the worktree that are not committed (e.g., scratch files outside `git add`)

## Self-check before publishing

Before any tool call that posts content to GitHub, re-read what you are about to send and ask:

1. Does this contain a path of the form `<word>/<word>/...` where the first word could be a username?
2. Does this quote a log line, DB row, or screenshot taken from staging or prod?
3. Would a search engine indexing this give someone outside Cardstack information about a specific user's data?

If yes to any: redact to the placeholder form above, or move the concrete detail to a linked Linear ticket and reference it by ID.

## Why this skill exists

PR comments are indexed by search engines, archived by third parties, and remain public forever. Pasting CloudWatch output, DB query results, or screenshots that include real user realm slugs into a PR comment ships that information out of Cardstack permanently — even if the comment is later edited or the PR is closed.
