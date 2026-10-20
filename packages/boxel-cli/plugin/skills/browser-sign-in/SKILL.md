---
description: Sign a browser into the Boxel app as a boxel-cli profile with `boxel browse`. Use when you or the user need to view, test, or verify the Boxel app in a browser — especially a host running locally or on any custom origin against staging or production, where the email/password form on the sign-in page is blank or won't load. Reach for this before Railway deploys, custom hostnames, or certificates.
---

# Signing a browser in

Wraps `boxel browse`, which mints a Matrix login token from a saved profile and builds a host-app URL that redeems it on load. The browser comes up signed in as that profile, optionally deep-linked to a card. It never touches the sign-in page.

## When to use it

- **A host on another origin.** A host served from `http://localhost:<port>/`, a preview, or any origin other than the environment's own can't use the email/password form: that form is a frame from the secure origin (`secure.stack.cards`, `secure.boxel.ai`), which only the environment's own app origins may frame. The symptom is a sign-in page whose email/password area is blank. `boxel browse --host-url` skips the form entirely. (Google SSO also works there.)
- **Agent-driven verification.** You need a signed-in browser to check a change, and the profile already has the account.
- **Opening a card signed in.** Pass the card's realm-relative path.

## Command shapes

| Situation                                     | Run                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Human at this machine, environment's own host | `boxel browse [card-path] --profile <id>`                                            |
| Local or custom host against staging          | `boxel browse --profile <id> --host-url http://localhost:<port>/ --print-url \| pbcopy` |
| Agent or remote shell                         | add `--print-url \| pbcopy` (or the platform's clipboard tool)                       |
| Rate-limited                                  | add `--wait`                                                                         |

`boxel profile list` shows the profiles. A staging profile is `@<user>:stack.cards`, with realm server `https://realms-staging.stack.cards/`. Without `--host-url`, the token is redeemed on the profile's realm-server origin (`https://localhost:4200/` for standard local dev).

A published-realm card URL needs no sign-in: `boxel browse <published-url>` opens it as-is, and `--print-url` then prints a plain public link.

## The URL is a credential

The URL `--print-url` prints carries a login token. Anyone holding it signs in as that account.

- Send it to the clipboard (`| pbcopy`). Never let it reach chat, a log, a file, or a commit.
- Don't open it or paste it into a browser yourself, including one you drive. Tell the human it's on their clipboard and ask them to paste it into their browser's address bar.
- It is single-use and expires in about 2 minutes. Mint it when the human is ready to paste, not ahead of time.

## Rate limit

Minting is limited to about once per minute per account, a Matrix limit that can't be raised. Short waits retry automatically; `--wait` blocks for a longer one and retries once. A used or expired URL can't be retried: mint a new one.

<!-- generated:commands:start -->

## Commands

_Generated from the boxel-cli Commander tree by_ `pnpm build:plugin`. _Edit prose outside the generated block — never inside it._

### `boxel browse [card-path]`

Open the Boxel app in your browser, already signed in as your active profile (a published-realm card URL opens directly, no sign-in needed)

**Arguments:**

- `[card-path]` — Card to open: a realm-relative path (opens signed in) or a published-realm URL (opens directly, no sign-in)

**Options:**

- `--profile <id>` — Profile to use (default: the active profile)
- `--host-url <url>` — Override the host app URL the token is redeemed against
- `--print-url` — Print the authenticated URL instead of opening a browser (for remote shells / agents)
- `--wait` — If login-token minting is rate-limited (~1/min per account), wait out the reported delay (or a full window when none is reported) and retry once instead of erroring

<!-- generated:commands:end -->

## Pitfalls

- **The token lands on the wrong origin.** Browser sessions are origin-scoped. Pass `--host-url` with exactly the origin you'll test on: `http://localhost:4300/` and `https://localhost:4300/` are different origins.
- **Signed in as someone else.** The browser holds the account in the URL's token, not whatever it held before. Check `--profile` before minting.
- **The host and the profile must share a Matrix server.** The host redeems the token against the Matrix server it was built for, so a local host built against staging needs a staging profile, not a local one.
