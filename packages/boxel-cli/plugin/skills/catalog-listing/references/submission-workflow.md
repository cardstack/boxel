# Catalog Submission Workflow

Use this when a user asks to submit a catalog listing, make a PR for a listing, retry a failed submission, or inspect a `SubmissionWorkflowCard`.

## Mental Model

Catalog submission is a workflow, not an install/copy operation. The high-level action creates a `SubmissionWorkflowCard`, opens it for the user, and triggers the submission bot. The bot snapshots the listing files, creates a `PrCard`, commits the files to `cardstack/boxel-catalog`, opens a GitHub PR, and the workflow card tracks CI, review, and merge state.

## Entry Point

Preferred entry point:

- UI menu item on a catalog `Listing`: `Make a PR`
- Host command: `@cardstack/boxel-host/tools/create-and-open-submission-workflow-card`

Required input:

```ts
{
  realm: listingRealmUrl,
  listingId: listing.id,
  listingName: listing.name, // optional but strongly preferred
}
```

Use the high-level command. Do not create workflow cards by hand unless debugging, and do not bypass it by manually copying files into the catalog repo.

## Preconditions

Before starting the workflow:

- Listing card exists in a writable realm.
- Listing relationships are current: `specs`, `examples`, and `skills` point at the intended cards.
- Any generated specs have been refreshed with `listing-update-specs` if relevant.
- Source cards render and lint cleanly in their source realm.
- Listing examples are representative and safe to publish.
- No submitted content depends on private realms, local-only URLs, or unresolved cross-realm references.
- The host can find both catalog realms: one ending in `/catalog/` and one ending in `/submissions/`.
- The submission bot is configured and can be invited to the workflow Matrix room.

## What The Command Creates

`CreateSubmissionWorkflowCommand` does this:

1. Waits for Matrix readiness.
2. Loads the listing to recover `listingName` and `summary`.
3. Creates a Matrix room named `PR: <listingName>`.
4. Invites the submission bot.
5. Computes one branch name with `toBranchName(listingName)` and stores it on the workflow card so retries reuse the same branch.
6. Creates a `SubmissionWorkflowCard` in the listing realm with:
   - `title: Submit <listingName>`
   - `submittedBy`
   - `catalogRealmUrl`
   - `roomId`
   - `branchName`
   - `listing` relationship
   - `prCard` relationship initially null
7. Opens the workflow card in interact mode.
8. Sends a bot trigger event:
   - type: `pr-listing-create`
   - input: `roomId`, `realm`, `listingId`, `workflowCardUrl`, `workflowCardRealm`, `branchName`, optional listing metadata.

## Bot Workflow

The bot runner handles `pr-listing-create` and `pr-listing-retry`.

Fresh submission:

1. `collect-files` — runs `@cardstack/catalog/commands/collect-submission-files/default`.
2. `lint` — currently patched as skipped in staging/prod while OOM is investigated; it records `lintStatus: passed`. Treat this as temporary and still run normal source lint before submission.
3. `create-pr-card` — creates a `PrCard` in the `/submissions/` realm as the submission bot.
4. Links `SubmissionWorkflowCard.prCard` to the created `PrCard`.
5. Creates/reuses a GitHub branch from the stored branch name.
6. Commits the collected files under the branch/folder path.
7. Opens a GitHub PR against `cardstack/boxel-catalog`.
8. Clears `prCreationError` and `failedStep` on success.

`collect-submission-files` uses the same planning primitives as catalog install:

- `PlanBuilder`
- `planModuleInstall`
- `planInstanceInstall`

It includes listing specs, module files, spec instances, expanded examples, and linked skills. It rewrites source realm absolute URLs to relative repo paths so the submitted package is self-contained after merge. Binary files are separated from text files so they bypass `PrCard` size limits and are committed directly.

## Workflow Card State

`SubmissionWorkflowCard` presents five user-facing steps:

1. Choose a Listing
2. Create PR
3. CI Checks
4. Reviewer Approve
5. Merge into Catalog

It stores and displays:

- `listing`
- `prCard`
- `roomId`
- `branchName`
- `catalogRealmUrl`
- `lintStatus`
- `lintErrors`
- `lintFixedCount`
- `prCreationError`
- `failedStep`

It queries GitHub event cards for pull request, check run, check suite, and review events, then computes CI/review/merge status from those events plus the linked `PrCard`.

## Failure Handling

Workflow failures are recorded on the workflow card:

- `failedStep`: one of `collect-files`, `lint`, `create-pr-card`, `github-pr`
- `prCreationError`: readable error message

There is no live `retry-submission-workflow` host command in the current monorepo checkout. If a submission fails, inspect the workflow card and the bot/GitHub event cards before deciding whether to rerun the submission workflow or recover manually.

## Agent Rules

- Use the workflow command for submission. Do not synthesize PR branches or copy catalog files manually.
- Treat the workflow card as the canonical state object. Report its URL, current step, `failedStep`, `prCreationError`, and PR URL if linked.
- Run source lint and preview before submission because the bot lint step may be temporarily skipped.
- If submission fails before the workflow card is created, inspect Matrix room cleanup errors and rerun from the listing. If the workflow card exists, inspect it first so room, branch, and PR card identity are not accidentally duplicated.

## Source Pointers

- Listing menu: `packages/catalog-realm/catalog-app/listing/listing.gts`
- Workflow command: `packages/host/app/tools/create-submission-workflow.ts`
- Open wrapper: `packages/host/app/tools/create-and-open-submission-workflow-card.ts`
- Workflow card: `packages/catalog-realm/submission-workflow-card/submission-workflow-card.gts`
- File collection: `packages/catalog-realm/commands/collect-submission-files.ts`
- Bot workflow: `packages/bot-runner/lib/pr-listing/pr-listing-workflow-handler.ts`
- GitHub PR writer: `packages/bot-runner/lib/pr-listing/create-listing-pr-handler.ts`
