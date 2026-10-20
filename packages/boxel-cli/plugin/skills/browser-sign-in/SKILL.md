---
description: Sign a browser into the Boxel app as a boxel-cli profile with `boxel browse`. Use when you or the user need to view, test, or verify the Boxel app in a browser — especially a host running locally or on any custom origin against staging or production, where the email/password form on the sign-in page is blank or won't load. Run it on the user's behalf; reach for it before Railway deploys, custom hostnames, or certificates.
---

# Signing a browser in

Wraps `boxel browse`, which mints a Matrix login token from a saved profile and builds a host-app URL that redeems it on load. The browser comes up signed in as that profile, optionally deep-linked to a card. It never touches the sign-in page.

## When to use it

- **A host on another origin.** A host served from `http://localhost:<port>/`, a preview, or any origin other than the environment's own can't use the email/password form: that form is a frame from the secure origin (`secure.stack.cards`, `secure.boxel.ai`), which only the environment's own app origins may frame. The symptom is a sign-in page whose email/password area is blank. `boxel browse --host-url` skips the form entirely. (Google SSO also works there.)
- **Showing the user a change.** They want to see it signed in, and a profile already has the account.
- **Opening a card signed in.** Pass the card's path on the realm server, for example `ctse/my-realm/Person/1` (owner, realm, then the card), not a path inside one realm. With no card path the app opens on the workspace chooser.

## Run it yourself

When the user wants a browser signed in, run `boxel browse` for them. Don't hand them a command to run and paste. It is a one-time sign-in: the CLI passes the URL straight to the machine's default browser (`open` / `xdg-open`), so the login token never appears in the terminal output or the chat, and the host strips it from the address bar once it is redeemed.

| Situation                             | Run                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------- |
| Staging or production, on its own host | `boxel browse [card-path] --profile <id>`                              |
| Local or custom host against staging  | `boxel browse [card-path] --profile <id> --host-url http://localhost:<port>/` |
| Rate-limited                          | add `--wait`                                                           |

`boxel profile list` shows the profiles; match an account the user names ("my tribecaprep account") to its ID there, and pass `--profile` even when it is the active one. A staging profile is `@<user>:stack.cards`, with realm server `https://realms-staging.stack.cards/`; a production one is `@<user>:boxel.ai`, with `https://app.boxel.ai/`. Without `--host-url`, the token is redeemed on the profile's realm-server origin (`https://localhost:4200/` for standard local dev).

The browser that opens is the user's default browser, not one you drive. You can't see it, so a clean exit ("Opening <host> as <id>") is all the confirmation you get: tell the user which account should be signed in and to say if the page shows otherwise.

A published-realm card URL needs no sign-in: `boxel browse <published-url>` opens it as-is.

## Pick the browser

Sign in the browser the work happens in. Sessions live in each browser's own storage, so signing in one doesn't sign in another.

| Browser                                                     | How                                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| The user's default browser                                  | `boxel browse … --profile <id>`, as above                                                                   |
| A specific browser, such as Chrome for debugging            | macOS: `url=$(boxel browse … --profile <id> --print-url) && open -a "Google Chrome" "$url"`. Linux: `google-chrome` in place of `open -a …` |
| A browser you drive through the user's Chrome (an extension) | the Chrome row, then drive the tab it opens                                                                 |
| A browser you drive that is separate from the user's (an in-app browser pane, a headless browser) | the user pastes the URL: see below                                                                          |

In the Chrome row the URL goes from the CLI to Chrome through a shell variable, so it never reaches the output, and `&&` stops Chrome opening when `boxel browse` fails (its error is on stderr). Run exactly that shape: never print `$url`, and don't add `echo`. Don't read the tab's address back to check it either. Chrome opens the URL in its last-used profile; if the user has several Chrome profiles, have them bring the right one forward first.

**A browser you drive that isn't the user's.** You would have to navigate it to the URL yourself, which puts the token in your hands, so don't. Open that browser on the host, run `boxel browse … --profile <id> --print-url | pbcopy` (or the platform's clipboard tool), and ask the user to paste into its address bar within 2 minutes. Pass `--host-url` when that browser is on a local or custom origin.

## Keep the token out of your context

The login URL is a credential: until it is redeemed, anyone holding it signs in as that account. Running `boxel browse` without `--print-url` keeps it out of your hands, which is why that is the default.

- Never let `--print-url` output reach your terminal output. Send it straight into a browser launcher (`url=$(…) && open -a … "$url"`) or a clipboard tool (`| pbcopy`), as in the table above.
- If the CLI can't launch a browser, it prints the URL as a fallback. Don't repeat it, open it, or paste it anywhere; tell the user to sign in another way or re-run on their machine.
- It is single-use and expires in about 2 minutes, so mint it when the browser should open, not ahead of time.

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

- **"has no stored Matrix access token".** The profile was saved before boxel-cli stored tokens instead of passwords, so it can't mint a login token. `browse` won't fall back to the stored password. The user has to sign the profile in again with `boxel profile add -u <id> --staging` (or `--production`), which asks for the password: don't type or reuse it yourself. Try another profile meanwhile.
- **The token lands on the wrong origin.** Browser sessions are origin-scoped. Pass `--host-url` with exactly the origin you'll test on: `http://localhost:4300/` and `https://localhost:4300/` are different origins.
- **Signed in as someone else.** The browser holds the account in the URL's token, not whatever it held before. Check `--profile` before minting.
- **The host and the profile must share a Matrix server.** The host redeems the token against the Matrix server it was built for, so a local host built against staging needs a staging profile, not a local one.
