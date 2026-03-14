PR Creation Flow — Direct Submission-to-PR Linking

Context

This documents the current submission workflow for catalog listing PRs. PR cards are created during Flow A, immediately after the GitHub PR is opened, and the submission card is linked to that PR card in a separate follow-up patch step. GitHub webhook processing only stores event cards for later PR status, CI, and review queries.

---
Flow A: Bot-Runner → Create Submission → Open GitHub PR → Create PR Card → Link Submission

Triggered when a user initiates a listing submission (for example via a Matrix room command).

Orchestrated in: `packages/bot-runner/lib/command-runner.ts`

| Order | Operation | File | Return Response |
| --- | --- | --- | --- |
| 1 | `CreateSubmissionCommand` builds `SubmissionCard` with listing snapshot files | `packages/catalog-realm/commands/create-submission.ts` | `SubmissionCard { id, roomId, branchName, listing, allFileContents[] }` |
| 2 | `getSubmissionCardUrl()` extracts the submission card URL from the command result | `packages/bot-runner/lib/command-runner.ts` | `string` |
| 3 | `ensureCreateListingBranch()` creates the Git branch from `main` | `packages/bot-runner/lib/create-listing-pr-handler.ts` | `void` |
| 4 | `addContentsToCommit()` writes the submission files into the branch | `packages/bot-runner/lib/create-listing-pr-handler.ts` | `void` |
| 5 | `openCreateListingPR()` opens the GitHub PR | `packages/bot-runner/lib/create-listing-pr-handler.ts` | `CreatedListingPRResult { prNumber, prUrl, prTitle, branchName } \| null` |
| 6 | `createAndLinkPrCard()` orchestrates the post-PR follow-up work | `packages/bot-runner/lib/command-runner.ts` | `void` |
| 7 | `CreatePrCardCommand` creates the `PrCard` in the submissions realm as the submissions bot | `packages/catalog-realm/commands/create-pr-card.ts` | `PrCard { id, prNumber, prUrl, prTitle, branchName, submittedBy, submittedAt }` |
| 8 | `patch-card-instance` patches the original `SubmissionCard.prCard` relationship in the user's realm | `@cardstack/boxel-host/commands/patch-card-instance/default` | `ready \| error` |

---
Flow B: GitHub Webhook → Process Event → Save GithubEventCard

Triggered when GitHub sends webhook events such as `pull_request`, `check_run`, `check_suite`, or `pull_request_review`.

Entry point: `packages/realm-server/handlers/webhook-filter-handlers.ts`
Command: `packages/catalog-realm/commands/process-github-event.gts`

| Order | Operation | File | Return Response |
| --- | --- | --- | --- |
| 1 | GitHub webhook received and validated | `packages/realm-server/handlers/webhook-filter-handlers.ts` | Routes to `ProcessGithubEventCommand` |
| 2 | `GithubEventFilterHandler.buildCommandInput()` extracts `eventType`, `realm`, and `payload` | `packages/realm-server/handlers/webhook-filter-handlers.ts` | `{ eventType, realm, payload }` |
| 3 | `ProcessGithubEventCommand` saves `GithubEventCard` only | `packages/catalog-realm/commands/process-github-event.gts` | `GithubEventCard { eventType, payload, action, prNumber, prUrl }` |

---
Linking: SubmissionCard → PrCard

`SubmissionCard` now links directly to its PR card:
- `SubmissionCard` is still created in the user's original realm.
- `PrCard` is created in the `/submissions/` realm.
- `SubmissionCard.prCard` points across realms to the exact `PrCard` created after GitHub opens the PR.
- `SubmissionCard.branchName` remains as display/debug metadata.
- `PrCard.branchName` remains for display and webhook-event correlation.
- Submission card UI reads `@model.prCard` directly`.

---
Key Files

- `packages/bot-runner/lib/command-runner.ts`
- `packages/bot-runner/lib/create-listing-pr-handler.ts`
- `packages/catalog-realm/commands/create-submission.ts`
- `packages/catalog-realm/commands/create-pr-card.ts`
- `@cardstack/boxel-host/commands/patch-card-instance/default`
- `packages/catalog-realm/commands/process-github-event.gts`
- `packages/catalog-realm/submission-card/submission-card.gts`
- `packages/catalog-realm/pr-card/pr-card.gts`
