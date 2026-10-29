# Boxel CLI

**Unlock the power of Boxel with your own agent harness.**

`boxel` puts a Boxel workspace on your local filesystem, so the agent you
already use — Claude Code, Cursor, your own script — can read and write the
cards in it directly. Pull a realm down, let your agent edit it, push it back.

```bash
npx @cardstack/boxel-cli --help
```

## Why you would want this

A Boxel realm is a live workspace of cards: typed, composable, schema-declared
software you normally edit in the browser. That is great for people and awkward
for agents, which want files.

This CLI is the bridge.

- **Bring your own agent.** `realm pull` gives you the realm as files, `push`
  and `sync` carry your changes back. Whatever edits files can now edit cards —
  no plugin, no integration, no Boxel-specific agent.
- **Your realm's skills become your agent's skills.** `pull`, `sync` and
  `watch` mirror each `skills/<name>/SKILL.md` into
  `.claude/skills/<realm>-<name>/`, so the same skill Boxel's assistant loads is
  available in a Claude Code session as `/<realm>-<name>`. One definition, both
  harnesses.
- **Work across your realms and profiles.** `boxel profile add` keeps a named
  identity per account and environment — production, staging, local, or your
  own realm server — and every command takes the realm you point it at. Move
  between workspaces and accounts without re-authenticating or leaving the
  terminal.
- **Nothing to stand up.** It talks to a hosted realm. No Docker, no Matrix
  server, no local stack — that is only needed if you are developing Boxel
  itself.

New to Boxel? Start at [boxel.ai](https://boxel.ai) — then come back here when
you want an agent working on your cards.

## Community

- [Discord](https://discord.gg/boxel) — questions, help, and what people are building
- [@boxel_ai](https://x.com/boxel_ai) on X — releases and demos
- [cardstack/boxel](https://github.com/cardstack/boxel) — issues and source

## Installation

### Global Installation (Recommended)

```bash
npm install -g @cardstack/boxel-cli
```

### Per-project Installation

```bash
npm install @cardstack/boxel-cli
npx boxel --help
```

### Development Installation

```bash
git clone https://github.com/cardstack/boxel.git
cd boxel/packages/boxel-cli
pnpm install
pnpm build
```

## Usage

```bash
boxel --help
boxel --version
```

### Signing in with `boxel profile add`

`boxel profile add` opens your browser to sign in: with a password, with Google, or by creating an account. The page is on the realm server's secure origin (`secure.boxel.ai` for production), the origin Boxel keeps passwords on, away from the app's card code. Once you sign in, the page hands the CLI, which is waiting on a port on `127.0.0.1`, a single-use token that the CLI turns into a sign-in of its own. The same sign-in also lets `boxel keys` manage your keys, so a new profile doesn't need a separate `boxel keys sign-in`.

The other ways in don't open a browser and work as before:

- `--no-browser` asks for a username and password in the terminal.
- `-u` with `BOXEL_PASSWORD` (or `-p`) signs in without asking anything, for CI.
- `boxel profile migrate` builds a profile from `MATRIX_URL`, `MATRIX_USERNAME`, `MATRIX_PASSWORD` and `REALM_SERVER_URL`.

A realm server whose secure origin can't sign the CLI in gets the host app's own `/cli-auth` page instead, and so does `--host-url`, which names the origin whose page to open. Profiles you already have keep working; nothing asks you to sign in again.

### Managing your keys with `boxel keys`

Your keys belong to you, not to a realm, so the key commands name no realm; only the share commands do.

```bash
boxel keys list
boxel keys show    <name>                            # the key and the shares it's in
boxel keys add     <name> [--stdin | --key-file <path>]
boxel keys replace <name> [--stdin | --key-file <path>]
boxel keys delete  <name> [--yes]                    # lists the shares it suspends, then asks
boxel keys share   <name> --realm <url> [--as <label>]
boxel keys unshare <label> --realm <url>
boxel keys swap    <label> --realm <url> --key <your-key>
boxel keys shares  --realm <url>

# OAuth
boxel keys add     <name> --kind oauth-client --client-id <id> --authorize-url <url> --token-url <url> [--scopes <scope>...] [--api-host <url>]
boxel keys clients [--realm <url>]                    # the clients you can connect through
boxel keys connect <name> --client <platform:<name> | share-label | your-client> [--realm <url>]
```

A key's value is never a command-line argument. `add` and `replace` ask for it at a masked prompt that shows a `*` for each character and, once you press Enter, the last few characters (at most 4, never more than a quarter of it, and none of a value of 8 characters or fewer), so you can tell it's the one you meant. Without a terminal, pass `--stdin` or `--key-file`; otherwise the command refuses rather than wait. No command prints a value.

Adding, replacing, deleting, sharing and swapping need you signed in on the secure origin, which `boxel profile add` or `boxel keys sign-in` does. If you aren't, the command opens the sign-in in your browser first. `boxel keys status` says whether you are, and `boxel keys sign-out` ends it. A key you add here can't be sent anywhere yet: where it may go is granted when you approve an operation that uses it.

Some services sign you in with OAuth instead of handing you a key. An **OAuth client** is an app registered with the service: `add --kind oauth-client` stores one, with its client secret entered at the masked prompt like any key's value and its client id, sign-in page, token endpoint and scopes as options (`--grant-type client_credentials` for one that mints tokens with no person, which takes no `--authorize-url`). Share a client into a realm and everyone there can connect their own account through it, without seeing its secret. `clients` lists what you can connect through: Boxel's own (`platform:github`, Boxel's read-only GitHub App), yours, and with `--realm` the ones shared into that realm. `connect` opens the service's sign-in in your browser; once you approve there, the service sends the browser back through the realm server to the secure origin, which finishes the sign-in and keeps the result as one of your keys, an OAuth connection. No token passes through the CLI or is printed. Name a shared client by its label with `--realm`, one of yours by its key name, and one of Boxel's as `platform:<name>`.

`swap` puts one of your keys into a suspended share in a realm you write to; the share resumes with you as its owner. Every command takes `--json`. A refusal prints the server's status and reason, and under `--json` it prints `{ "error": { "status", "reason", "errors" } }` with the server's `errors` unchanged.

### Choosing an environment for `boxel profile add`

`boxel profile add` targets **production**. Whichever environment it lands on is resolved the same way for the interactive and non-interactive paths, in this order:

1. `--matrix-url` / `--realm-server-url` / `--host-url` — a per-field override on top of whatever the following rules chose.
2. `--staging` or `--local` (`--production` is the default, accepted so a script can say so explicitly). Passing more than one exits with an error.
3. The domain of the `-u` Matrix ID: `boxel.ai`, `stack.cards`, or `localhost`. Any other domain requires `--matrix-url` and `--realm-server-url`.
4. `BOXEL_ENVIRONMENT` (see below).
5. Production.

A recognized `-u` domain deliberately outranks `BOXEL_ENVIRONMENT`: the mise tasks export that variable, so it lingers in a shell, and letting it win would write a profile whose Matrix ID and URLs describe different environments.

### Environment variables

These are read by `boxel profile add`:

- `BOXEL_PASSWORD` — password for non-interactive profile creation. Preferred over `-p/--password`, which exposes the password in shell history and process listings.
- `BOXEL_ENVIRONMENT` — env-mode slug (typically a branch name) for per-branch local dev. Interpreted like `scripts/env-slug.sh`: the value is slugified (lowercased, `/` → `-`, other chars stripped) and URLs are derived as `https://matrix.<slug>.localhost` and `https://realm-server.<slug>.localhost/`. Overridden per the precedence above. Values that slugify to empty (e.g. `!!!`) exit with an error — but only when the variable is actually consulted, so a fully-specified invocation is unaffected.

Example — create a profile for a branch running in env mode:

```bash
BOXEL_PASSWORD=… BOXEL_ENVIRONMENT=cs-10998-my-branch \
  boxel profile add -u @alice:cs-10998-my-branch.localhost
```

Example — create a profile against a custom realm server:

```bash
BOXEL_PASSWORD=… boxel profile add \
  -u @alice:my.server \
  --matrix-url https://matrix.my.server \
  --realm-server-url https://realms.my.server/
```

### Realm skills in Claude Code

A realm's user-authored skills live in it as `skills/<name>/SKILL.md`. `boxel realm pull`, `sync`, and `watch` copy each one into `<local-dir>/.claude/skills/<realm>-<name>/`, so the same skill Boxel's AI assistant loads is available in a Claude Code session as `/<realm>-<name>`.

The mirror always lands in the realm's own local directory; nothing is searched for up the tree. Claude Code loads nested `.claude/skills/` directories below the working directory, so a realm pulled into a subdirectory still surfaces its skills, directory-qualified when two skills share a name. The home directory itself is refused, since `~/.claude/skills` is Claude Code's personal scope.

The copies are generated output, rewritten on every run: edit a skill in the realm checkout's `skills/` — that is what `push` and `sync` carry back to the realm — because an edit made under `.claude/skills/` is overwritten without warning. `.claude/skills/.boxel-skills-sync.json` records which entry names boxel wrote, so an entry whose realm-side skill is renamed or removed is deleted while a directory boxel did not write is left alone.

Set `BOXEL_DISABLE_CLAUDE_SKILLS_SYNC=1`, or pass `--no-claude-skills`, to skip it.

### Files a realm leaves out

`.gitignore` and `.boxelignore` both name files that aren't part of the realm. Use `.boxelignore` for files git should still track, such as tests, build scripts and a package's README.

- When `push` and `sync` upload local files, they skip what either file matches, and always skip `node_modules` and dotfiles. An ignore file in a subdirectory applies to the files below it. Because dotfiles are never uploaded, the ignore files themselves stay local.
- A realm the realm-server serves from a directory on disk reads the two files at that directory's root as one gitignore-syntax list, `.gitignore` first, so a `!` line in `.boxelignore` can re-include a path `.gitignore` excludes. A matching file is not indexed, listed or served, and the row of a file that becomes ignored is removed. Neither file can ignore itself. The realm applies the rules on its next from-scratch index; an incremental index, such as the one a single file write triggers, keeps the rules it already has.

## Development

### Building

```bash
# Clean and build bundled executable
pnpm build
```

### Development Script

```bash
# Run from TypeScript source (no build step required)
pnpm start
```

### Local Development

Run directly from TypeScript source without building:

```bash
cd packages/boxel-cli
pnpm start -- <command> [args]

# Examples:
pnpm start -- --help
pnpm start -- sync .
pnpm start -- profile list
```

No build step needed — changes to source are reflected immediately.

### Local Development with `npm link`

To use the `boxel` command globally during development:

```bash
# From packages/boxel-cli
npm link

# Now you can use `boxel` anywhere — no build required
boxel --help
boxel sync .
```

The linked command runs `dist/index.js`, so build the CLI first (`pnpm --filter @cardstack/boxel-cli build`). The TypeScript source isn't run directly.

To unlink:

```bash
npm unlink -g @cardstack/boxel-cli
```

### Code Quality

```bash
# Linting
pnpm lint
pnpm lint:fix

# Type checking
pnpm lint:types
```

### Testing

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run integration tests
pnpm test:integration
```

#### Integration test prerequisites

`pnpm test:integration` requires:

1. **Docker** — for the test Postgres container (started automatically by
   the test runner script).
2. **Dev stack running** — host app on `:4200`, base realm on
   `:4201/base/`, prerender service on `:4221`, prerender manager on
   `:4222`, worker-base, and dev Postgres on `:5435`. Some integration
   tests (currently `search.test.ts`) pass `useRealPrerenderer: true`
   to `startTestRealmServer()` so card indexing exercises the real
   Chrome prerenderer. Without the dev stack up, those tests fail
   their `beforeAll` with a clear "host unreachable" message; the rest
   of the suite still passes with a noop prerenderer.

   The simplest way to start everything for local dev is from the
   repo root:

   ```bash
   mise run dev-all
   ```

   This starts the host app first, waits for it to be ready, then
   starts the realm server and supporting services (see the repo
   root README's "ember-cli Hosted App" section for details). Leave
   it running in another terminal, then run `pnpm test:integration`
   from `packages/boxel-cli/`.

   For a lighter setup (skips experiments / catalog / homepage /
   submission realms), use the two-step recipe instead:

   ```bash
   # in one terminal
   pnpm start                                  # from packages/host/

   # in another, after host is up
   mise run dev-minimal                        # from repo root
   ```

   To match CI exactly (production-style host serve, no live reload),
   build the host first and then run the matrix test-services task:

   ```bash
   # one-time, from repo root
   pnpm --filter @cardstack/host build

   # then, from packages/realm-server/
   mise run test-services:matrix
   ```

   `mise run test-services:matrix` brings up host-dist, base realm,
   prerender service, prerender manager, icons, worker-base, and dev
   Postgres — the minimum needed for real card indexing. It expects
   the host dist to already exist on disk; that's what the build step
   above (or the CI's `test-web-assets` artifact) provides.

In CI, the `boxel-cli-test` job downloads the pre-built `test-web-assets`
artifact (host + icons dist) and then runs `mise run test-services:matrix`
in the background before the integration suite (see
`.github/workflows/ci.yaml`).

### Publishing

```bash
# Version bumping
pnpm version:patch  # 0.0.1 -> 0.0.2
pnpm version:minor  # 0.0.1 -> 0.1.0
pnpm version:major  # 0.0.1 -> 1.0.0

# Publishing
pnpm publish:dry    # Dry run to see what would be published
pnpm publish:npm    # Publish to npm registry
```

### Testing Built Version

```bash
# Build and test locally
pnpm build
node dist/index.js --help

# Test as installed package
npm pack
npm install -g ./cardstack-boxel-cli-0.0.1.tgz
boxel --help
```

## Architecture

The package uses esbuild to create a standalone executable that bundles all dependencies:

- **`boxel`** - Standalone executable for Boxel workspace management

## Requirements

- Node.js 18 or higher

## License

MIT
