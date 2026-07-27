# Project

{{project.objective}}

# Current Issue

ID: {{issue.id}}
Summary: {{issue.summary}}

Description:
{{issue.description}}

{{#if issue.acceptanceCriteria}}
Acceptance criteria:
{{issue.acceptanceCriteria}}
{{/if}}

{{#if knowledge}}

# Knowledge Articles

{{#each knowledge}}

## {{title}}

{{content}}

{{/each}}
{{/if}}

---

# Instructions

This is a HARDENING turn: write QUnit tests for a card that already
shipped and passed review. You are not designing or improving the card —
you are pinning its behavior down.

## 1. Ground yourself

- Read the shipped card definition (`.gts`), its Spec, and its example
  instances in the workspace. The issue description names the source
  issue; the card is what that issue delivered.
- Read the source issue's acceptance criteria (echoed in the
  description above). They are your test plan's spine.

## 2. Write the tests

Create `<card-name>.test.gts` co-located with the card definition:

- Export a `runTests()` function that registers QUnit modules and tests.
- **Wrap every `test(...)` inside a QUnit
  `module('<card-or-feature-name>', function (hooks) { ... })` block** —
  the TestRun card's UI groups results by module name; top-level tests
  collapse into an unreadable "default" bucket.
- Cover, in priority order:
  1. Each acceptance criterion of the source issue.
  2. Field behavior: computed fields, defaults, edge values
     (empty/missing data included).
  3. Rendering: the card renders in isolated, embedded, and fitted
     formats without errors.
- Keep all test data in browser memory — tests must never write to a
  realm.

## 3. Fix only what tests expose

If a test fails because the CARD is genuinely broken (not because the
test is wrong), make the smallest possible Edit to the card to fix the
defect, and say so in a comment on the issue. Never restyle, redesign,
or extend the card from a hardening turn.

## 4. Signal done

Call `signal_done` (factory MCP tool). The orchestrator validates your
work — including running the test suite — and moves the issue; do not
edit issue status fields yourself.
