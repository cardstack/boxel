---
name: sentry
description: >-
  Read Sentry (cardstack.sentry.io) read-only from a Claude session: find an
  issue from an alert email or a short ID, list its events, read its tags
  (for example `process`, `environment`, `release`), see how Sentry grouped
  it and why a second issue opened, and find which release first sent it.
  Uses `scripts/claude-sentry.sh`, which reads a read-only Sentry token from
  SSM with the `boxel-claude-readonly` AWS session that `mise run claude-aws`
  makes, so there is no Sentry setup per developer. Use whenever a Sentry
  alert or Sentry issue arrives, when asked "did this happen again after the
  fix", "is this a new issue or a repeat", "which process sent this", "how
  many events", or whenever log lines alone can't say how Sentry counted or
  grouped an error.
allowed-tools: Read, Grep, Glob, Bash
---

# Sentry (read-only)

Claude reads Sentry through `scripts/claude-sentry.sh`. The script reads a
Sentry API token from SSM Parameter Store
(`/<env>/sentry/claude_readonly_token`) with the `claude-staging` or
`claude-prod` AWS profile, then calls `https://sentry.io/api/0/<path>`. It
prints the JSON response.

## Access model

- The token belongs to a Sentry **internal integration** in the `cardstack`
  org with only Organization: Read, Project: Read and Issue & Event: Read
  (`org:read`, `project:read`, `event:read`). It cannot resolve, ignore,
  assign or delete issues, and cannot change alert rules. A write call
  returns 403. Don't try one.
- The `boxel-claude-readonly` role can read the parameter, so access follows
  the AWS session: it needs the user's MFA and ends when the session
  expires (12 h). CloudTrail records who read the token.
- There is one Sentry org for staging and production, so the same token is
  in both accounts. Either session reads events from every Sentry
  environment. Filter by environment in the query, not by session.
- The Terraform for the parameter and the grant is in the infra repo,
  `configs/boxel-claude-access/base/main.tf` (`aws_ssm_parameter.sentry_token`
  and the `ReadSentryTokenParameter` statement). That file also says how the
  token is created and stored.

## Before you call it

1. Check that an AWS session is valid (see the `aws-access` skill):
   `grep claude_session_expiration ~/.aws/config`. If both sessions have
   expired, ask the user to run `mise run claude-aws staging <MFA_TOKEN>`.
   Don't try to refresh it yourself.
2. Never print the token, put it in a command line, or read the parameter
   with `aws ssm get-parameter` yourself. Always go through the script.

## Usage

```sh
scripts/claude-sentry.sh [--env staging|prod] [--headers] <api-path>
```

`<api-path>` is relative to `https://sentry.io/api/0/`. Pipe the output to
`jq`. The script makes exactly one GET request to that URL and takes no
other curl arguments: an extra URL would receive the token too. `--headers`
writes the response headers to stderr. Their `Link` header holds the cursor
for the next page (follow it when `results="true"`, by adding
`&cursor=<cursor>` to the path).

The org slug is `cardstack`. The Sentry environment names are the values of
`REALM_SENTRY_ENVIRONMENT`: `staging` and `production`. List the project
slugs once instead of guessing them:

```sh
scripts/claude-sentry.sh organizations/cardstack/projects/ | jq -r '.[].slug'
```

## Recipes

### From an alert email to the issue

An alert email names the issue's short ID (for example `PROJECT-1AB`) and
links to `.../issues/<numeric id>/`. With the short ID:

```sh
scripts/claude-sentry.sh organizations/cardstack/shortids/<SHORT-ID>/ \
  | jq '{groupId, project: .group.project.slug, title: .group.title}'
```

### Issue summary: count, first and last seen, first release

```sh
scripts/claude-sentry.sh organizations/cardstack/issues/<id>/ \
  | jq '{title, culprit, status, count, userCount, firstSeen, lastSeen,
         firstRelease: .firstRelease.version, lastRelease: .lastRelease.version}'
```

### "Did this happen again after the fix?"

List the newest events and compare their times and releases with the fix's
deploy:

```sh
scripts/claude-sentry.sh "organizations/cardstack/issues/<id>/events/?environment=production" \
  | jq '.[] | {dateCreated, eventID, release: (.tags[]? | select(.key=="release") | .value)}'
```

The latest event in full, with tags, contexts and breadcrumbs:

```sh
scripts/claude-sentry.sh organizations/cardstack/issues/<id>/events/latest/ | jq .
```

### Tags: which process, which environment, which release

```sh
# Every tag key with its top values and counts
scripts/claude-sentry.sh organizations/cardstack/issues/<id>/tags/ \
  | jq '.[] | {key, totalValues, top: [.topValues[] | {value, count}]}'

# All values of one tag
scripts/claude-sentry.sh organizations/cardstack/issues/<id>/tags/process/values/ \
  | jq '.[] | {value, count, firstSeen, lastSeen}'
```

### Grouping: why did a second issue open?

Sentry puts two events in one issue only when their grouping hashes match.
Compare the two issues' hashes, then the grouping info of one event from
each:

```sh
scripts/claude-sentry.sh organizations/cardstack/issues/<id>/hashes/ | jq '.[].id'

scripts/claude-sentry.sh projects/cardstack/<project-slug>/events/<event-id>/grouping-info/ \
  | jq '.variants | to_entries[] | select(.value.contributes) | {variant: .key, hash: .value.hash, type: .value.type}'
```

Usual causes: a different project (each service can report to its own
project), a different exception type or message that the message-based
variant includes, or different in-app stack frames. Read the contributing
variant, not only the title.

### Search issues

```sh
scripts/claude-sentry.sh "organizations/cardstack/issues/?query=is:unresolved%20pricing&environment=staging&statsPeriod=14d" \
  | jq '.[] | {id, shortId, title, count, lastSeen, project: .project.slug}'
```

URL-encode the query. The search syntax is Sentry's issue search, for
example `is:unresolved`, `process:worker` or `release:<version>`.

## Privacy

Sentry events can hold user data: URLs, realm names, request details and
breadcrumbs. Treat what you read like log and database data (the
`pr-privacy` skill). It can go in Linear, but not in public PRs, commits,
code comments or test fixtures.

## Troubleshooting

| Symptom                                         | Cause and action                                                                                                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `couldn't read the Sentry token from SSM`       | Both AWS sessions expired, or the infra change isn't applied in that account. Check the session first; then `aws --profile claude-staging ssm describe-parameters --parameter-filters Key=Name,Values=/staging/sentry/claude_readonly_token`. |
| `the SSM parameter still holds its placeholder` | The token hasn't been stored yet. A Sentry org owner or manager must create the internal integration and run the `put-parameter` command from the infra comment.                                                                              |
| HTTP 401                                        | The integration's token was revoked or rotated. Ask whoever manages it to store a new one in SSM in both accounts.                                                                                                                            |
| HTTP 403                                        | The call needs a scope the token doesn't have (any write, or member and team data). That is by design.                                                                                                                                        |
| HTTP 404 on an issue                            | Wrong org-scoped path, or the issue was deleted or merged. A merged issue's events moved to the issue it was merged into.                                                                                                                     |
