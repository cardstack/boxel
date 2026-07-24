import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { runBoxel } from '../helpers/run-boxel.ts';
import type { ParseRealmResult } from '../../src/commands/parse.ts';

// Drives `boxel parse --json` as a subprocess against the CLI binary
// selected by BOXEL_CLI_BIN (see tests/helpers/run-boxel.ts). Under the
// tarball / published contexts this runs the npm-hoisted install — the
// layout where `boxel parse`'s glint type-check silently resolves
// nothing, which no in-process, function-call test could reach.
//
// Each fixture is a plain realm-workspace directory of card code. parse
// defaults to type-checking the current working directory, so we point
// the subprocess `cwd` at the fixture — no copying, parse writes nothing
// to it.

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures/parse');

// Message the CLI emits when ember-tsc exits non-zero but produced zero
// TS diagnostics — glint resolved nothing and checked nothing: a "pass"
// that never actually type-checked. It surfaces when the parse
// workspace's node_modules can't resolve the CLI's deps. No fixture may
// produce it — if one does, the install layout is broken, not the card.
const NOTHING_CHECKED = 'produced no TS diagnostics';

async function parseFixture(name: string): Promise<ParseRealmResult> {
  let res = await runBoxel(['parse', '--json'], {
    cwd: resolve(FIXTURES_DIR, name),
  });
  return res.json<ParseRealmResult>();
}

// ---------------------------------------------------------------------------
// Primary behavior: glint runs against an npm install and the CLI's
// tsconfig aliases + bundled types resolve, so real cards type-check
// clean. Each fixture pins a distinct resolution surface:
//   - plain-glimmer: field value types (`@model.someNumberField` →
//     `number`), which resolve through the `primitive` symbol bundled
//     from @cardstack/runtime-common.
//   - runtime-common: the bare `@cardstack/runtime-common` import
//     (the `realmURL` symbol, the `Query` type).
//   - boxel-host-tools: the `@cardstack/boxel-host/tools/*` alias + the
//     bundled `tools/` source.
//   - helpers-and-fields: a `@cardstack/boxel-ui/helpers` call
//     (`formatDateTime` with its `format` named arg) plus direct
//     interpolation of `contains(NumberField)` / `contains(TextAreaField)`
//     field values.
// ---------------------------------------------------------------------------
const CLEAN_FIXTURES: { name: string; covers: string }[] = [
  {
    name: 'plain-glimmer',
    covers: 'field value types via the primitive symbol',
  },
  { name: 'runtime-common', covers: 'bare @cardstack/runtime-common import' },
  { name: 'boxel-host-tools', covers: '@cardstack/boxel-host/tools/* import' },
  {
    name: 'helpers-and-fields',
    covers: 'boxel-ui helper call + field interpolation',
  },
];

describe('boxel parse (against the installed CLI)', () => {
  describe.each(CLEAN_FIXTURES)('$name — $covers', ({ name }) => {
    it(
      'type-checks clean',
      async () => {
        let result = await parseFixture(name);
        // Surface the actual diagnostics on failure, not a bare count.
        expect(result.errors).toEqual([]);
        expect(result.status).toBe('passed');
        expect(result.filesChecked).toBeGreaterThanOrEqual(1);
      },
      { timeout: 180_000 },
    );
  });

  it(
    'type-checks a .test.gts using assert.dom clean (qunit-dom augmentation)',
    async () => {
      // parse checks every discovered `.gts`, including `.test.gts`. Those
      // call `assert.dom(...)` without importing qunit-dom, so the type
      // lib must be loaded or the test file fails to type-check.
      let result = await parseFixture('qunit-dom-test');
      expect(result.errors).toEqual([]);
      expect(result.status).toBe('passed');
      expect(result.filesChecked).toBeGreaterThanOrEqual(1);
    },
    { timeout: 180_000 },
  );

  it(
    'surfaces a real diagnostic for a genuine type error (proves glint ran)',
    async () => {
      let result = await parseFixture('deliberate-type-error');
      expect(result.status).toBe('failed');
      expect(result.errorCount).toBeGreaterThanOrEqual(1);

      let messages = result.errors.map((e) => e.message).join('\n');
      // A real TS2322 from a genuine type mismatch…
      expect(messages).toMatch(/not assignable to type 'number'/);
      // …and specifically NOT the environmental "nothing got checked"
      // message that masks a broken type-resolution setup as a pass.
      expect(messages).not.toContain(NOTHING_CHECKED);
    },
    { timeout: 180_000 },
  );
});

// ---------------------------------------------------------------------------
// Known typing gap, deferred to follow-up work:
//
//   - tracked-format-class — `@tracked` alongside a `<template>` inside a
//     `static isolated = class … {}` expression trips glint's
//     "Decorators are not valid here". A glint/ember-tsc transform
//     limitation for decorators in class expressions; it reproduces in
//     both the monorepo and the published layout, so it isn't a
//     bundled-types gap.
//
// Marked `it.fails`: an expected failure while the CLI lacks support for
// the pattern, so it runs without failing CI. An unexpected pass makes
// `it.fails` itself fail — the signal to remove the marker and move the
// case into the block above.
// ---------------------------------------------------------------------------
describe('boxel parse — known typing gaps (deferred)', () => {
  const DEFERRED = ['tracked-format-class'];

  describe.each(DEFERRED)('%s', (name) => {
    it.fails(
      'does not yet type-check clean in a published install',
      async () => {
        let result = await parseFixture(name);
        expect(result.errors).toEqual([]);
        expect(result.status).toBe('passed');
      },
      { timeout: 180_000 },
    );
  });
});
