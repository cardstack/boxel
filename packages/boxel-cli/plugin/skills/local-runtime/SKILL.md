---
name: local-runtime
description: Start, stop, inspect and diagnose a Boxel stack managed by the native local runtime.
---

Use `boxel up`, `boxel down`, `boxel status --json` and `boxel doctor --json` to
control a runtime that Boxel Desktop or `boxel-local serve` has already started.
These commands do not require a hosted profile. They must run in the native
agent or terminal, never in an untrusted Boxel page.

Use the SDK `BoxelRuntimeClient` from `@cardstack/boxel-cli/api` for the same
operations. The default endpoint is `http://127.0.0.1:4243`; `BOXEL_RUNTIME_URL`
or `--endpoint` selects another HTTP loopback origin. Remote endpoints,
credential-bearing URLs and redirects are rejected. An unavailable runtime is
an error: this client does not yet install assets or start the daemon.

`up` is idempotent. Inspect every service's readiness before using the stack;
`down` asks the runtime to stop its owned services. Use `doctor` to report a
failed check, and preserve its nonzero exit status in automation.

<!-- generated:commands:start -->

## Commands

_Generated from the boxel-cli Commander tree by_ `pnpm build:plugin`. _Edit prose outside the generated block — never inside it._

### `boxel up [stack]`

Start a stack managed by the native Boxel runtime

**Arguments:**

- `[stack]` — Runtime stack name

**Options:**

- `--endpoint <url>` — Native runtime HTTP loopback origin (or BOXEL_RUNTIME_URL)
- `--json` — Emit structured status as JSON

### `boxel down [stack]`

Stop a stack managed by the native Boxel runtime

**Arguments:**

- `[stack]` — Runtime stack name

**Options:**

- `--endpoint <url>` — Native runtime HTTP loopback origin (or BOXEL_RUNTIME_URL)
- `--json` — Emit structured status as JSON

### `boxel status [stack]`

Inspect a stack managed by the native Boxel runtime

**Arguments:**

- `[stack]` — Runtime stack name

**Options:**

- `--endpoint <url>` — Native runtime HTTP loopback origin (or BOXEL_RUNTIME_URL)
- `--json` — Emit structured status as JSON

### `boxel doctor [stack]`

Diagnose a stack managed by the native Boxel runtime

**Arguments:**

- `[stack]` — Runtime stack name

**Options:**

- `--endpoint <url>` — Native runtime HTTP loopback origin (or BOXEL_RUNTIME_URL)
- `--json` — Emit structured status as JSON

<!-- generated:commands:end -->
