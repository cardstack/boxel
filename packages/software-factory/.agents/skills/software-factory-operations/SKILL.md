---
name: software-factory-operations
description: Use when implementing cards in a target realm through the factory execution loop — covers the tool-use workflow for searching, writing, testing, and updating tickets via factory tools.
---

# Software Factory Operations

Use this skill when operating inside the factory execution loop. The factory agent communicates with realms exclusively through **executable tool functions** — not local filesystem writes or boxel CLI commands.

## Realm Roles

- **Source realm** (`packages/software-factory/realm`)
  Publishes shared modules, briefs, templates, and tracker schema. Never write to this realm.
- **Target realm** (user-specified, passed to `factory:go`)
  Receives all generated artifacts: Project, Ticket, KnowledgeArticle, card definitions, card instances, Catalog Spec cards, and Playwright test files.
- **Test artifacts realm** (auto-created, e.g., `<target>-test-artifacts`)
  Receives only card instances created during test execution. Each test run gets its own folder (`Run 1/`, `Run 2/`).

## Available Tools

The agent has these tools during the execution loop. Use them by name — they are provided via the LLM's native tool-use protocol.

### Reading and Searching

- `read_file({ path, realm? })` — Read a file from target or test realm. Use before modifying anything.
- `search_realm({ query, realm? })` — Search for cards using a structured query object (filter, sort, page). Use to check for existing cards, find duplicates, inspect project state.

### Writing Files

- `write_file({ path, content, realm? })` — Write a file to the target or test realm. Path must include extension (`.gts`, `.json`, `.spec.ts`). The `realm` arg defaults to `"target"`; use `"test"` for the test realm.

### Updating Project State

- `update_project({ path, attributes, relationships? })` — Update a Project card in the target realm. The tool's parameters include a dynamic JSON schema describing available fields — use it to know valid field names and types. The tool auto-constructs the JSON:API document with the correct `adoptsFrom`.
- `update_ticket({ path, attributes, relationships? })` — Update a Ticket card. Same structured interface with dynamic field schema in the tool parameters.
- `create_knowledge({ path, attributes, relationships? })` — Create or update a KnowledgeArticle card. Same structured interface with dynamic field schema in the tool parameters.
- `create_catalog_spec({ path, attributes, relationships? })` — Create a Catalog Spec card in the target realm's `Spec/` folder. Makes a card definition discoverable in the Boxel catalog. Same structured interface with dynamic field schema. The tool auto-constructs the document with `adoptsFrom` pointing to `https://cardstack.com/base/spec#Spec`.

### Testing

- `run_tests({ slug, specPaths, testNames?, projectCardUrl? })` — Execute Playwright tests against the target realm. Pulls test spec files from the realm, runs them via the Playwright harness, returns structured results (pass/fail counts, failure details with error messages and stack traces).

### Running Host Commands

- `run_command({ command, commandInput? })` — Execute a host command on the realm server via the prerenderer. Commands run in browser context with full card runtime access (Loader, CardAPI, services). Use the specifier format `@cardstack/boxel-host/commands/<name>/default`.

**Example — generate JSON schema for a card type:**

```
run_command({
  command: "@cardstack/boxel-host/commands/get-card-type-schema/default",
  commandInput: {
    codeRef: {
      module: "https://realm.example/darkfactory",
      name: "Project"
    }
  }
})
```

Returns `{ status: "ready", result: "<serialized JsonCard with schema>" }`. Parse `result` as JSON to get the schema with `attributes` and `relationships` properties.

### Control Flow

- `signal_done()` — Signal that the current ticket is complete. Call this only after all implementation and test files have been written.
- `request_clarification({ message })` — Signal that you cannot proceed and need human input. Describe what is blocking.

## Required Flow

1. **Inspect before writing.** Use `search_realm` and `read_file` to understand what already exists in the target realm before creating or modifying files.
2. **Move ticket to `in_progress`.** Use `update_ticket` to set the ticket status before starting implementation.
3. **Write card definitions** (`.gts`) via `write_file` to the target realm.
4. **Write card instances** (`.json`) via `write_file` to the target realm.
5. **Write a Catalog Spec card** (`Spec/<card-name>.json`) for each top-level card defined in the brief. Link sample instances via `linkedExamples`.
6. **Write Playwright test files** (`Tests/<ticket-slug>.spec.ts`) via `write_file` to the target realm. Every ticket must have at least one test file.
7. **Call `signal_done()`** when all implementation and test files are written. The orchestrator triggers test execution after this.
8. **If tests fail**, the orchestrator feeds failure details back. Use `read_file` to inspect current state, then `write_file` to fix implementation or test files. Call `signal_done()` again.
9. **Update ticket state** via `update_ticket` — update notes, acceptance criteria, and related knowledge as work progresses.

## Target Realm Artifact Structure

```
target-realm/
├── card-name.gts                    # Card definition
├── CardName/
│   └── sample-instance.json         # Card instance (also a test fixture)
├── Spec/
│   └── card-name.json               # Catalog Spec card
├── Tests/
│   └── ticket-slug.spec.ts          # Playwright test file
├── Test Runs/
│   └── ticket-slug-1.json           # TestRun card (written by orchestrator)
├── Projects/
│   └── project-name.json            # Project card
├── Tickets/
│   └── ticket-slug.json             # Ticket card
└── Knowledge Articles/
    └── article-name.json            # KnowledgeArticle card
```

## Writing Playwright Test Specs

Test spec files live in `Tests/<ticket-slug>.spec.ts` in the target realm. The orchestrator pulls them locally and runs Playwright. The following environment variables are injected at runtime:

| Variable                             | Description                                                    |
| ------------------------------------ | -------------------------------------------------------------- |
| `BOXEL_SOURCE_REALM_URL`             | Target realm URL (where card definitions live)                 |
| `BOXEL_TEST_ARTIFACTS_FOLDER_URL`    | URL for writing test card instances (includes `Run N/` folder) |
| `BOXEL_TEST_ARTIFACTS_AUTHORIZATION` | JWT for writing to the test artifacts realm                    |

**Card instances created during tests must go in the test artifacts realm** (via `BOXEL_TEST_ARTIFACTS_FOLDER_URL`), never in the target realm. Each test run gets its own folder to prevent collision.

### Example Spec

```typescript
import { expect, test } from '@playwright/test';

test('sticky note renders title', async ({ request }) => {
  let sourceRealmUrl = process.env.BOXEL_SOURCE_REALM_URL!;
  let artifactsFolderUrl = process.env.BOXEL_TEST_ARTIFACTS_FOLDER_URL!;
  let authorization = process.env.BOXEL_TEST_ARTIFACTS_AUTHORIZATION!;

  // Create an instance in the test artifacts realm
  let response = await request.post(
    artifactsFolderUrl + 'StickyNote/test-note.json',
    {
      headers: {
        Accept: 'application/vnd.card+source',
        'Content-Type': 'application/vnd.card+source',
        Authorization: authorization,
      },
      data: JSON.stringify({
        data: {
          type: 'card',
          attributes: { title: 'Test Note', body: 'Hello' },
          meta: {
            adoptsFrom: {
              module: sourceRealmUrl + 'sticky-note',
              name: 'StickyNote',
            },
          },
        },
      }),
    },
  );
  expect(response.ok()).toBe(true);

  // Read it back and verify
  let readResponse = await request.get(
    artifactsFolderUrl + 'StickyNote/test-note',
    {
      headers: {
        Accept: 'application/vnd.card+source',
        Authorization: authorization,
      },
    },
  );
  expect(readResponse.ok()).toBe(true);
  let card = await readResponse.json();
  expect(card.data.attributes.title).toBe('Test Note');
});
```

### Key Points

- The `adoptsFrom.module` must point to the card definition in the **source realm** (target realm URL + definition filename without extension)
- Use `application/vnd.card+source` MIME type for both `Accept` and `Content-Type` headers
- Use `data-test-*` attributes for DOM selectors when testing rendered output
- Never use `networkidle` — use `domcontentloaded` plus element assertions

## Important Rules

- **Never write to the source realm.** All generated artifacts go to the target realm.
- **Use realm HTTP APIs only.** The factory agent does not have access to the local filesystem or boxel CLI commands (`boxel sync`, `boxel push`, etc.). All reads and writes go through the realm API via tool functions.
- **Write source code, not compiled output.** When writing `.gts` files, write clean idiomatic source — never compiled JSON blocks or base64-encoded content.
- **Use absolute `adoptsFrom.module` URLs** when referencing definitions that live in a different realm (e.g., the source realm's tracker schema).
- **Playwright tests must not use `networkidle`.** Boxel host pages have long-lived network activity. Use `domcontentloaded` plus visible element assertions instead.
- **Start small and iterate.** Write the smallest working implementation first, then add the test. If tests fail, read the failure output carefully before making targeted fixes.
