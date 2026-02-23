# Submissions Flow

Submission flow is intentionally simple:

1. Host issues a Matrix bot-trigger event via `@cardstack/boxel-host/commands/create-listing-pr-request`, which calls `@cardstack/boxel-host/commands/send-bot-trigger-event` with `type: 'pr-listing-create'`.
2. `bot-runner` handles `pr-listing-create` and opens the GitHub PR in `packages/bot-runner/lib/create-listing-pr-handler.ts` (`openCreateListingPR`).
3. `bot-runner` runs `@cardstack/boxel-host/commands/create-submission` to create a `SubmissionCard` in the submissions realm.


```
http://localhost:4200/command-runner/%40cardstack%2Fboxel-host%2Fcommands%2Fcreate-submission%2Fdefault/%7B%22realm%22%3A%22http%3A%2F%2Flocalhost%3A4201%2Fexperiments%2F%22%2C%22roomId%22%3A%22!JTWMmANZcCwUHMIyaD%3Alocalhost%22%2C%22listingId%22%3A%22http%3A%2F%2Flocalhost%3A4201%2Fcatalog%2FAppListing%2F95cbe2c7-9b60-4afd-8a3c-1382b610e316%22%2C%22listingName%22%3A%22Blog%20App%22%7D/1
```
