---
description: Manage saved boxel-cli profiles (credentials for users / environments). Use when the user wants to list profiles, add a new profile, switch the active profile, remove a profile, or migrate from a legacy .env file.
---

# Profiles

Wraps `boxel profile`, which manages credentials for different users and environments. Profiles live in `~/.boxel-cli/profiles.json` (mode 0600).

## When the user asks to...

| Ask                                                   | Run                                           |
| ----------------------------------------------------- | --------------------------------------------- |
| "what profiles do I have?" / "who am I logged in as?" | `boxel profile list`                          |
| "log in" / "add a new account"                        | `boxel profile add` (interactive — preferred) |
| "switch to my staging account"                        | `boxel profile switch <username-or-fragment>` |
| "remove that old profile"                             | `boxel profile remove <profile-id>`           |
| "import from my old .env"                             | `boxel profile migrate`                       |

## Profile IDs

Profiles use the Matrix ID format: `@username:domain`.

- Production: `@username:boxel.ai`
- Staging: `@username:stack.cards`
- Local dev: `@username:<env-slug>.localhost`

`switch` accepts a partial match — `boxel profile switch sarah` is enough if there's only one profile matching `sarah`.

## Which environment a new profile targets

`boxel profile add` targets production. `--staging` and `--local` pick another environment instead (at most one of `--production` / `--staging` / `--local`); there is no environment prompt.

With `-u`, the Matrix ID's own domain decides — `boxel.ai`, `stack.cards`, and `localhost` are recognized, and any other domain needs `--matrix-url` and `--realm-server-url`.

## Signing in through the browser

`boxel profile add` opens the browser, waits for the user to sign in there (password or Google), and then saves the profile. It waits up to 30 minutes for the browser, and the browser can only hand the sign-in to the command while it is still running.

- Run it once, in the background or with the longest timeout your shell tool allows, so the tool doesn't kill it while the user is signing in. Read its output when it exits.
- Don't re-run it while it's waiting, and don't re-run it after the user reports "You're signed in" in the browser. Each run opens another sign-in. `Profile created` in its output means it is done. If it was killed before printing that, the sign-in did not complete.
- With no terminal attached, as when an agent runs it, it asks nothing after the sign-in. It saves the account the user signed in as, and replaces a profile already stored for that account (keeping its display name). It becomes the active profile only if no other profile is active; otherwise it prints the `boxel profile switch` command to use.
- Check the `Signed in as` line against the account the user meant. A Google sign-in whose email matches no account creates a new one. If it isn't the account they meant, tell the user before switching to it.
- If the browser wait runs out with no terminal attached, it exits with an error rather than falling back to asking for a username and password. `--no-browser` does the same. Those sign-ins need `BOXEL_PASSWORD` and `-u`, below.

## Adding profiles non-interactively

For automation, set `BOXEL_PASSWORD` in the environment instead of passing `-p`:

```bash
BOXEL_PASSWORD="..." boxel profile add -u @sarah:boxel.ai -n "Sarah - Prod"
```

`-p` works but exposes the password in shell history and process listings. Prefer `BOXEL_PASSWORD`.

## Custom matrix / realm-server URLs

For ephemeral environments (PR previews, branch deploys), `BOXEL_ENVIRONMENT` derives URLs from a slug:

```bash
BOXEL_ENVIRONMENT=my-branch boxel profile add -u @sarah:my-branch.localhost
# → matrix at https://matrix.my-branch.localhost
# → realm-server at https://realm-server.my-branch.localhost/
```

Override individually with `--matrix-url` / `--realm-server-url` if needed — these win over both `BOXEL_ENVIRONMENT` and the environment flags, field by field.

<!-- generated:commands:start -->

## Commands

_Generated from the boxel-cli Commander tree by_ `pnpm build:plugin`. _Edit prose outside the generated block — never inside it._

### `boxel profile [subcommand] [arg]`

Manage saved profiles for different users/environments

**Arguments:**

- `[subcommand]` — list | add | switch | remove | migrate
- `[arg]` — Profile ID (for switch/remove)

**Options:**

- `-u, --user <matrixId>` — Matrix user ID (e.g., @user:boxel.ai)
- `-p, --password <password>` — Password (for add command)
- `-n, --name <displayName>` — Display name (for add command)
- `-m, --matrix-url <url>` — Matrix server URL (for add command with non-standard domains)
- `-r, --realm-server-url <url>` — Realm server URL (for add command with non-standard domains)
- `--no-browser` — Sign in with a username and password in the terminal instead of opening a browser (for add command)
- `--host-url <url>` — Sign in on this origin's /cli-auth page instead of the realm server's secure origin (for add command)
- `--production` — Target production — the default (for add command)
- `--staging` — Target staging instead of production (for add command)
- `--local` — Target a local dev server instead of production (for add command)
- `--json` — Output the complete profile set as JSON (for list command)

<!-- generated:commands:end -->

## Pitfalls

- A fresh machine has no profiles. `boxel profile list` returns empty until `boxel profile add` is run at least once.
- The active profile is per-shell — switching doesn't propagate to other open terminals automatically.
- `migrate` is a one-shot operation for users coming from the old `.env` storage. New users don't need it.
