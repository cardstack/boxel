---
name: pr-review
description: Review a GitHub pull request thoroughly and post the findings as one inline-first pending review. Builds subsystem context before judging, verifies every claim empirically against the checked-out branch, classifies each finding (regression / pre-existing / follow-up / confirmation), and writes comments with enough mechanism and background that an author unfamiliar with that part of the codebase can act on them without a follow-up question. Use whenever asked to review a PR, give feedback on a pull request, or re-review after the author pushes changes. For the local working diff use the built-in code-review skill (a Claude Code built-in, not a repo skill); for a local guided tour without posting anything, use review-branch.
allowed-tools: Read, Grep, Bash(gh pr view *, gh pr diff *, gh api *, git fetch *, git log *, git diff *, git worktree *), mcp__github__pull_request_review_write, mcp__github__add_comment_to_pending_review, mcp__github__add_reply_to_pull_request_comment
---

# PR Review

A review here is a teaching document as much as a quality gate. The author may not know the subsystem their change lands in, so every comment carries the claim, the mechanism behind it, the evidence, and a concrete way out — written for a reader who has never opened the file. Thoroughness means tracing and verifying, not accumulating nits.

## Contracts that bind every review

Load these companion skills before writing a single comment; each applies in **both directions** — to the diff under review and to the review's own output:

- **pr-comment-attribution** — every comment the review posts — inline comments, thread replies, and the review body — begins with the `[Claude Code 🤖]` prefix.
- **pr-privacy** — scan the diff for user data the author is about to publish (fixtures, code comments, screenshots, PR text), and scan the review's own comments before posting: quoting a log line or DB row into a review comment publishes it.
- **evergreen-comments** — the review's own prose is evergreen (no ticket IDs, no PR numbers, no journey narration), and the diff's new or edited comments, docs, and skill files are checked for temporal wording, tracker references, and journey narration as a standing review dimension.

If the diff touches an area with a dedicated domain skill (index-query-engine, search, gts-component-conventions, ember-best-practices, …), load it — those files carry the invariants the change must preserve, which is exactly what a review checks.

## Phase 1 — Context before judgment

1. **The PR itself**: description, linked issues, and every existing comment — issue comments, review bodies, and inline threads, including bot reviewers (`gh pr view`, `gh api repos/{owner}/{repo}/pulls/{n}/comments`, `.../pulls/{n}/reviews`, `.../issues/{n}/comments`).
2. **Settled vs. open discussion**: decisions already agreed in threads get referenced, never relitigated. Open questions in threads are review obligations — the review body should answer them with the mechanical facts that decide them.
3. **Bot findings are leads, not findings.** Verify reachability with a concrete path through the code before repeating one. Confirmed → fold it into the relevant comment along with the verification. Unverified → don't amplify it.
4. **Check out the head branch** read-only in a worktree under `.claude/worktrees/`. Never commit to or push another author's branch. The diff shows what changed; the review is about how that lands in the code around it, which requires the whole tree.
5. **Read beyond the diff.** For each non-trivial hunk, read the enclosing file, then the callers and callees of everything it touches. The highest-value findings usually live one call site away from the diff.

## Phase 2 — Investigate like the next owner

Work through the diff as if inheriting the code, not skimming it.

- **Trace the mechanism, not the appearance.** For each behavioral claim — in code, comments, tests, or the PR description — follow the actual code path and name it: files, functions, the branch taken. A claim that can't be traced is a finding in itself.
- **Verify empirically when the claim is checkable.** Run the query and read the plan; write the four-line repro; execute the test; compile the expression and inspect the output. Paste the evidence into the comment — one verified claim outweighs ten hedged ones. Hedged phrasing in your own draft ("probably", "I believe", "should") is a to-do marker: go check, then delete either the hedge or the claim.
- **Hunt twin implementations.** Where one contract has two homes — the Postgres and SQLite adapters, server-side SQL compilation vs. client-side matching (`index-query-engine.ts` / `instance-filter-matcher.ts`), wire spelling vs. internal API — confirm the change landed on all of them. Twin divergence is a top finding class because nothing fails loudly when they drift.
- **Hunt drift-by-duplication.** A decision re-implemented in two places (a filter literal repeated across call sites, a copied assembly loop) drifts the first time one copy learns something. Enumerate every site; suggest the single home.
- **Look for orphans.** Does the change leave dead machinery behind — a node kind with no emitters, an adapter rewrite with no remaining producer, an index no plan uses? Check what still depends on it before calling it dead; partial deadness ("only one of these rewrites is now unused") is the common case.
- **Cost the hot paths.** Columns fetched but never read, per-row work inside loops, predicates no index can serve, cache keys that split on semantically equal spellings.
- **Tests pin what they claim.** A test asserting output *shape* can read as confirming *semantics* it never checks. Ask of each new test: what would have to break for this to fail? Flag asserted-but-misleading coverage and name the missing negative-space test. Where a contract is guarded only by comments on both sides, suggest the executable check that would replace the comment.
- **Docs move with contracts.** If the diff changes documented behavior, the docs are part of the diff — and doc claims get verified like code claims (a key documented as "present on both row kinds" is checked against the code that stamps it).
- **Migrations**: paired schema regeneration, `down()` fidelity against the exact names/opclasses the original migration created, and the concurrency pattern established in the migrations directory.

## Phase 3 — Classify every finding

Every finding states its class explicitly — this is what lets the author act on a large review without triaging it themselves:

- **Regression** — introduced by this PR. The fix belongs in this PR.
- **Pre-existing, now load-bearing** — the bug predates the PR, but the PR builds on it or widens its blast radius. Say both halves: "not this PR's bug" and "this PR now depends on it". The fix is usually a follow-up; the PR may still need a wording or scoping change to avoid cementing the bug as intended behavior.
- **Follow-up** — a real improvement outside this PR's scope. Say so plainly ("that's a follow-up, not this PR") and describe it concretely enough to file.
- **Confirmation** — the change is right, and the comment documents *why* it is safe plus the conditions under which it would stop being safe. Confirmations are findings too: they are the guard rails the next editor reads. "Nothing to change" is a valid, useful comment.

Also mark blocking vs. non-blocking in prose. The submitted review event is always COMMENT — approve / request-changes is the human's call — so the words must carry the verdict.

## Phase 4 — Writing the comments

Anatomy of an inline comment, in order:

1. **The claim, first sentence.** What is wrong (or right) and what it costs.
2. **The mechanism.** Walk the code path with real names: which function, in which file, takes which branch.
3. **The evidence.** The repro, the query plan, the enumerated call sites — whatever was actually run or read.
4. **The way out.** A snippet when the fix is small; options with a recommendation when it isn't. GitHub ```suggestion blocks only for mechanical one-liners where the diff is the whole message.
5. **The scope.** Which Phase 3 class, and whether it blocks.
6. **Background, when the subsystem is deep.** One paragraph of "why this machinery exists" turns a confusing demand into something the author can act on.

Long comments get bold mini-headings (**What the engine actually emits.** / **Verified against a real dataset.** / **The fix.**) — length is fine; un-navigable length is not.

Placement:

- Critique targeting contiguous lines → inline comment anchored on exactly those lines (`start_line` + `line` for a range).
- About one file as a whole → file-level comment.
- Non-contiguous, cross-file, or architectural → the review body. Don't force an anchor that misleads.
- Comments within one review may cross-reference each other by file and subject ("see the comment on `entryTypeScope` in realm-index-query-engine.ts") — within a single review this doesn't rot.

Reference code by path and symbol name (`packages/runtime-common/expression.ts`, `typeCondition`), not bare line numbers — line numbers shift under the author's next push.

## Phase 5 — The review body

The body is the layer above the threads:

1. **Opening sentence: the lens.** What this review focused on and why that is the right lens for this PR.
2. **Bottom line, bolded.** The verdict in one or two sentences — including "no blocking issues" when true.
3. **What lands right.** Mechanistic engagement with the design's strengths, not courtesy praise — it tells the author which parts of the design to defend later.
4. **Answers to open discussion questions**, decided by mechanical facts rather than preference.
5. **Numbered recommendations**, each one line plus a pointer to the inline thread that carries the detail.
6. **Adjacent, out of scope** — nearby rot noticed along the way, flagged for whoever touches it next, explicitly not asked of this PR.

## Phase 6 — Post

If the user asked for an opinion ("what do you think of this PR?") rather than a review, report the findings in the terminal and confirm before posting anything to GitHub.

Post as **one pending review** so it lands atomically:

1. `mcp__github__pull_request_review_write`, method `create` → pending review.
2. `mcp__github__add_comment_to_pending_review` for each inline / file-level comment.
3. `mcp__github__pull_request_review_write`, method `submit_pending`, event `COMMENT` — never APPROVE or REQUEST_CHANGES.

Pre-submit self-check over every comment and the body:

- Starts with `[Claude Code 🤖]`.
- No user data (pr-privacy pass over your own text, including pasted command output).
- Evergreen: no ticket IDs, no PR numbers, no journey narration in your prose.
- Every claim either carries its evidence or states that it was verified and how.
- Every finding carries its class and blocking-ness.

Then report back to the user: the bottom line, the finding count by class, and a link to the review.

## After posting — replies and re-reviews

Replies and new pushes re-open the loop. A re-review's job is continuity: critique what changed in response to each thread, in that thread.

1. **Scope the diff.** Diff since the last reviewed commit rather than restarting from zero. Unchanged code is settled except where the changed code implicates it — a fix landing on one twin implementation but not the other, a moved decision leaving a stale copy behind — so re-run the Phase 2 twin and drift checks on whatever changed.
2. **Verify each fix as a change, not as compliance.** Read the actual commits; don't trust the reply's description of them. A response can fix the symptom while missing the mechanism the thread named, introduce its own regression, or land on only one of the twins. The response gets the same Phase 2 rigor the original code got.
3. **Continue in the author's thread.** Critique of a change made in response to an existing comment lands as a threaded reply on that comment (`mcp__github__add_reply_to_pull_request_comment`, or `gh api repos/{owner}/{repo}/pulls/{n}/comments/{id}/replies`) — the thread carries the context and the history. A new inline comment is reserved for a genuinely new finding no existing thread covers; those post through the Phase 6 pending-review flow.
4. **Don't repeat the background.** The thread already explains why the machinery exists. When a change lands in an area an earlier comment covered, pick up at the thread's altitude — claim, what the new code does, evidence, verdict. Phase 4's background paragraph is for first contact with an area, not for every exchange about it.
5. **State each thread's disposition plainly.** "This resolves it", "resolves the X half; Y is still open", or "the fix introduces a new issue: …" — the author should never have to infer whether a thread is done. Answer every author response, even when the answer is only confirmation.

When many threads move at once, a short review body summarizing dispositions (resolved / still open / new findings) saves the author a thread-by-thread hunt; the detail stays in the threads.
