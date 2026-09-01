---
name: pr-review
description: Review a GitHub pull request thoroughly and post the findings as one inline-first pending review. Builds subsystem context before judging, verifies every claim empirically against the checked-out branch, and classifies each finding (regression / pre-existing / follow-up). The output is critique only: every comment asks the author for a change, a decision, or an answer, and carries just the mechanism that ask rests on — no verification logs, no narrating the diff back to the person who wrote it, no subsystem tours. Use whenever asked to review a PR, give feedback on a pull request, or re-review after the author pushes changes. For the local working diff use the built-in code-review skill (a Claude Code built-in, not a repo skill); for a local guided tour without posting anything, use review-branch.
allowed-tools: Read, Grep, Bash(gh pr view *, gh pr diff *, gh api *, git fetch *, git log *, git diff *, git worktree *), mcp__github__pull_request_review_write, mcp__github__add_comment_to_pending_review, mcp__github__add_reply_to_pull_request_comment
---

# PR Review

A review is critique, addressed to someone who already knows this code better than the reviewer does — usually the person who just wrote it. Thoroughness belongs to the investigation, not to the page: trace everything, verify everything, then post only what the author has to act on.

Every comment asks for something — a change, a decision, or an answer — and every _sentence_ inside it earns its place by changing what the author does about that ask. Explaining a change back to its author is the failure this skill exists to prevent: it reads as thorough, it costs the author real time, and the comments that do need their attention get buried behind it.

Expect most of the work to stay invisible. A review that traced six paths and found one problem posts one comment; the other five are why that comment can be trusted, not five more things to read.

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
- **Verify empirically when the claim is checkable.** Run the query and read the plan; write the four-line repro; execute the test; compile the expression and inspect the output. Verification is what earns the right to state a claim flatly; the comment then carries only the part of it the author needs in order to believe the claim, never the transcript of the check. Hedged phrasing in your own draft ("probably", "I believe", "should") is a to-do marker: go check, then delete either the hedge or the claim.
- **Hunt the load-bearing comment.** A comment that _justifies_ rather than describes — "the store is job-scoped, so a resident instance is current", "the tab is reset on the first render of each job", "keeps the credential in this subshell only" — is an assertion the code has to keep, and it is where a reviewer's attention is least likely to land, because the comment reads as the answer to the question it raises. For each one, find the mechanism that would have to enforce it and confirm that mechanism still reaches that far. The tells are justifying words: _so_, _because_, _safe since_, _always_, _never_, _only ever_, _guaranteed_.

  Four ways it goes wrong, all seen in this repo. The claim was true when written and the mechanism has since narrowed (a cache reset that now fires only on executable invalidation, while the comment still says "each job"). The mechanism reaches less than the words do (a reset that clears one tab of the five serving a pass). A change adds a _new_ claim its own call path does not deliver (a boundary observed on the load path, when the path that matters never loads). Or prose and code contradict outright a dozen lines apart (a rule saying the password is never exported, above a flow that exports it).

  Two things make this class worth its own pass. It is invisible to tests and typecheckers, because nothing is wrong _locally_ — the code does what it says on the line, just not what the paragraph above promises. And a false justification is load-bearing in the worst way: the next author reads it, believes the invariant, and builds a short-circuit or a reuse on top of it. That is how a stale-read bug gets _designed in_ rather than introduced.

  Not finding the mechanism is not itself a finding — it may only mean the search was incomplete, and this skill does not post speculation. Keep looking: name the mechanism and show it reaches, or name a path where the invariant is violated. What you may post without a demonstrated failure is a **question about a specific named invariant** — "this reads as guaranteeing X; the reset I can find fires only on Y, so what holds X for the other cases?" — which is answerable in one reply by whoever wrote it, and is the shape the comment rules below already require. Never dress that question up as a defect claim.

- **Hunt twin implementations.** Where one contract has two homes — the Postgres and SQLite adapters, server-side SQL compilation vs. client-side matching (`index-query-engine.ts` / `instance-filter-matcher.ts`), wire spelling vs. internal API — confirm the change landed on all of them. Twin divergence is a top finding class because nothing fails loudly when they drift.
- **Hunt drift-by-duplication.** A decision re-implemented in two places (a filter literal repeated across call sites, a copied assembly loop) drifts the first time one copy learns something. Enumerate every site; suggest the single home.
- **Hunt the consumers a narrowed type left behind.** A diff that brands or narrows a widely-used type — `string` to a branded identifier, a union down to one member — compiles precisely _because_ the new type still satisfies the old one, so a green typecheck is evidence of nothing. The finding is the call sites that were correct against the old type and are wrong against the new one: whatever parses, concatenates, slices, or compares the old spelling. A re-typing spanning a hundred files has usually audited the definitions and not the consumers. Ask for the enumeration.

  The class also runs backwards: untouched code goes wrong the day a type it reads is narrowed. The blindness there is the typechecker's, not the review's — but the sweep it takes is not the one above, because a breaking consumer need never name the narrowed type. `new URL(ref.module)` mentions no identifier type at all, so reading outward through callers and callees does not reach it. Enumerate instead by the operations that assume the old spelling — parsing, slicing, concatenating, comparing — across the whole tree. A diff that narrows a type owes that sweep; one that fixes a single such site owes an account of what swept for the rest.

  Two traps make a careful reviewer wrong here. The inferred type is not enough — a branded string is a subtype of `string`, so a union of the two reduces to plain `string`, and a value that has been through a ternary, a concatenation, or a template literal carries no brand while still being an identifier at runtime. And `new URL()` accepts a realm identifier, throwing only for the prefix form and only at runtime, so `new URL(x)` where `x` traces back to a code ref, a card id, or a realm identifier is verify-don't-assume.

- **Look for orphans.** Does the change leave dead machinery behind — a node kind with no emitters, an adapter rewrite with no remaining producer, an index no plan uses? Check what still depends on it before calling it dead; partial deadness ("only one of these rewrites is now unused") is the common case.
- **Cost the hot paths.** Columns fetched but never read, per-row work inside loops, predicates no index can serve, cache keys that split on semantically equal spellings.
- **Tests pin what they claim.** A test asserting output _shape_ can read as confirming _semantics_ it never checks. Ask of each new test: what would have to break for this to fail? Flag asserted-but-misleading coverage and name the missing negative-space test. Where a contract is guarded only by comments on both sides, suggest the executable check that would replace the comment.

  For a test accompanying a fix, the sharper version is: **would it fail without the fix?** A test that passes either way is documentation, not coverage, and it is easy to write by accident — the harness quietly supplies the condition the bug needs (a store the test process also writes to, a pool that hands out a fresh tab each time), so the scenario is reproduced in shape but not in substance.

  Check it the same way every other claim here gets checked: you already have the branch, so revert the fix hunk, run the test, and restore. A test that stays green is then a verified finding, and the comment carries the two words that make it undeniable — reverted, still passed. Only when the check is genuinely not runnable — the discriminating condition needs infrastructure the review cannot stand up — does this become a question for the author rather than a finding, and it is then asked as one. Either way the remedy worth suggesting is the same: a test pinned at the narrower unit, plus a plain statement of what is _not_ covered, beats an end-to-end test that cannot fail.

- **Docs move with contracts.** If the diff changes documented behavior, the docs are part of the diff — and doc claims get verified like code claims (a key documented as "present on both row kinds" is checked against the code that stamps it).
- **Migrations**: paired schema regeneration, `down()` fidelity against the exact names/opclasses the original migration created, and the concurrency pattern established in the migrations directory.

## Phase 3 — Classify every finding

Every finding states its class explicitly — this is what lets the author act on a large review without triaging it themselves:

- **Regression** — introduced by this PR. The fix belongs in this PR.
- **Pre-existing, now load-bearing** — the bug predates the PR, but the PR builds on it or widens its blast radius. Say both halves: "not this PR's bug" and "this PR now depends on it". The fix is usually a follow-up; the PR may still need a wording or scoping change to avoid cementing the bug as intended behavior.
- **Follow-up** — a real improvement outside this PR's scope. Say so plainly ("that's a follow-up, not this PR") and describe it concretely enough to file.

A verification that comes back clean is not a finding. Reading the whole path and concluding the change is safe is the work; posting that conclusion hands the author something to read and nothing to do, and it buries the comments that do ask for a change. This holds everywhere in the review, not only in the threads — a "what I verified" section in the body is the same non-finding with a heading on it, and the bolded bottom line already carries "this holds". The one thing worth extracting from a clean verification is a missing guard: where the change is only safe because of an invariant nothing enforces, the finding is the executable check, assertion, or code comment that would pin it — an ask, not an endorsement.

Also mark blocking vs. non-blocking in prose. The submitted review event is always COMMENT — approve / request-changes is the human's call — so the words must carry the verdict.

## Phase 4 — Writing the comments

A comment is the ask plus the shortest path to acting on it:

1. **The ask, first sentence.** What is wrong and what it costs — or, where the ask is a decision or an answer rather than a fix, what is unresolved and what turns on it.
2. **The way out.** A snippet when the fix is small; options with a recommendation when it isn't. GitHub ```suggestion blocks only for mechanical one-liners where the diff is the whole message.
3. **The scope.** Which Phase 3 class, and whether it blocks.

Everything else has to earn its way in. Mechanism and evidence are support, not sections: carry the step the ask actually rests on — the branch that makes the bug reachable, the two call sites that disagree, the enumeration that shows a case is unhandled — and stop there. The test for every sentence is **would the author act differently for having read it?** If not, it is exposition.

The exposition that shows up most, in rough order:

- **Narrating the diff back to its author.** They wrote it. Say what the change _misses_, not what it does. Quoting their own PR description or commit message back at them as evidence is the same move wearing evidence's clothes.
- **The subsystem tour.** Walking a load path in full when the ask is "declare this dependency in three manifests" — the author edits the three manifests either way. Depth that impressed you during investigation is not thereby worth the author's time.
- **The contrast case.** Why some _other_ code doesn't have this problem. A clause, if it is the model for the fix; never a paragraph.
- **The verification log.** Everything checked that came back clean (Phase 3).
- **The closing re-derivation** of a class and severity already stated.

Background is one or two sentences, and only when the ask is unintelligible without it — a name whose meaning isn't guessable from the file, an invariant that isn't visible there. Not a paragraph on why the machinery exists.

Length follows the ask, not the subsystem's depth: a subtle concurrency bug earns a long walk, "add this to the catalog" does not, however interesting the catalog turned out to be. The weaker the ask, the shorter the comment — length reached for on a minor finding is volume standing in for substance. Bold mini-headings (**What the engine actually emits.** / **The fix.**) keep a genuinely long comment navigable, but reaching for them is a cue to re-read it against the deletion test first: needing headings and needing cuts look the same from the inside.

Placement:

- Critique targeting contiguous lines → inline comment anchored on exactly those lines (`start_line` + `line` for a range).
- About one file as a whole → file-level comment.
- Non-contiguous, cross-file, or architectural → the review body. Don't force an anchor that misleads.
- **Anchor on the line the ask is about, not the line the investigation started from.** When a comment opens on one file and asks for a change in three others, the prose bridging the two is exposition by construction — move the comment to where the ask lands, or to the body.
- Comments within one review may cross-reference each other by file and subject ("see the comment on `entryTypeScope` in realm-index-query-engine.ts") — within a single review this doesn't rot.

Reference code by path and symbol name (`packages/runtime-common/expression.ts`, `typeCondition`), not bare line numbers — line numbers shift under the author's next push.

## Phase 5 — The review body

The body is the layer above the threads:

1. **Opening sentence: the lens.** One sentence on what this review went after. Its job is to tell the author what the review did _not_ cover, so a quiet review isn't read as a clean bill of health.
2. **Bottom line, bolded.** The verdict in one or two sentences — including "no blocking issues" when that is the finding. This sentence is the whole of the review's "this holds": never a tour of the design's strengths, never a list of what came back clean, never repeated per thread.
3. **Answers to open discussion questions**, decided by mechanical facts rather than preference.
4. **Numbered recommendations**, each one line plus a pointer to the inline thread that carries the detail. The detail stays in the thread; a recommendation that restates its thread gets read twice and acted on once.
5. **A red check the author has to act on** — or one they can ignore, with the reason. One line. Green CI goes unmentioned.
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
- Every comment asks for something — a change, a decision, or an answer. Anything that only records that the code is correct comes out. A reply that closes a thread the author opened is the exception: stating that a fix lands _is_ the answer they are waiting on.
- **One pass with a knife, over every comment and the body.** Take each sentence and ask what the author does differently for having read it. Cut what narrates their own diff back to them, what tours a subsystem the ask doesn't turn on, what explains why other code is fine, and what reports a clean check. On a review whose findings are all non-blocking, expect this pass to remove more than it keeps — that is exactly where volume substitutes for substance.

Then report back to the user: the bottom line, the finding count by class, and a link to the review.

## After posting — replies and re-reviews

Replies and new pushes re-open the loop. A re-review's job is continuity: critique what changed in response to each thread, in that thread.

1. **Scope the diff.** Diff since the last reviewed commit rather than restarting from zero. Unchanged code is settled except where the changed code implicates it — a fix landing on one twin implementation but not the other, a moved decision leaving a stale copy behind — so re-run the Phase 2 twin and drift checks on whatever changed.
2. **Verify each fix as a change, not as compliance.** Read the actual commits; don't trust the reply's description of them. A response can fix the symptom while missing the mechanism the thread named, introduce its own regression, or land on only one of the twins. The response gets the same Phase 2 rigor the original code got.
3. **Continue in the author's thread.** Critique of a change made in response to an existing comment lands as a threaded reply on that comment (`mcp__github__add_reply_to_pull_request_comment`, or `gh api repos/{owner}/{repo}/pulls/{n}/comments/{id}/replies`) — the thread carries the context and the history. A new inline comment is reserved for a genuinely new finding no existing thread covers; those post through the Phase 6 pending-review flow.
4. **Don't rebuild the context.** The thread already carries why the machinery exists and what the original finding was; re-explaining it is the exposition of Phase 4 with the author's own thread as its source. Pick up at the thread's altitude — what the change resolves, what it doesn't, and the evidence for the difference. A reply into an established thread is the shortest comment in the review.
5. **State each thread's disposition plainly.** "This resolves it", "resolves the X half; Y is still open", or "the fix introduces a new issue: …" — the author should never have to infer whether a thread is done. Answer every author response, including the ones where the fix simply lands — closing a thread the author is waiting on is an answer they need, not a note added for completeness.

When many threads move at once, a short review body summarizing dispositions (resolved / still open / new findings) saves the author a thread-by-thread hunt; the detail stays in the threads.
