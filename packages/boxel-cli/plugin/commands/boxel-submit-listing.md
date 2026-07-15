---
name: boxel-submit-listing
description: Submit a catalog listing through the workflow-card PR flow.
boxel:
  kind: skill
---

# /boxel-submit-listing

## Use When

- The user wants to submit a catalog listing for review.
- They say "make a PR", "submit this listing", "publish to catalog", or "retry this submission".

## Inputs

- Listing card URL or ID.
- Listing realm URL.
- Listing name when available.
- Existing `SubmissionWorkflowCard` URL when retrying.

## Read

1. `skills/catalog-listing/SKILL.md`
2. `skills/catalog-listing/references/submission-workflow.md`
3. `skills/boxel-environment/SKILL.md`

## Procedure

1. Confirm this is submission/retry, not install/remix.
2. Before submission, verify the listing relationships are current: `specs`, `examples`, and `skills`.
3. Run normal source validation before invoking the workflow: lint relevant `.gts` files and preview representative examples.
4. For a new submission, invoke `CreateAndOpenSubmissionWorkflowCardCommand` with `realm`, `listingId`, and `listingName`.
5. For retry, invoke `RetrySubmissionWorkflowCommand` with `workflowCardId`.
6. Use the workflow card as the state source. Report the workflow card URL, current step, and PR URL if linked.

## Done Criteria

- [ ] High-level workflow command used; no manual catalog repo copy.
- [ ] SubmissionWorkflowCard exists and is opened/tracked.
- [ ] For retry, existing workflow card reused.
- [ ] User receives the workflow URL and any PR URL or blocked step.

## Failure Recovery

- Workflow card exists and has `failedStep` / `prCreationError` → retry the workflow card.
- No workflow card was created → rerun submission from the listing after confirming the listing still exists.
- CI/review failure → do not retry submission; inspect the linked PR and GitHub event status.
