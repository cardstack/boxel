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
// TS diagnostics — i.e. glint resolved nothing and checked nothing. A
// "pass" that never actually type-checked. The primary bug: an npm
// install put the CLI's deps in a hoisted node_modules the parse
// workspace's symlink didn't point at, so glint aborted with this before
// checking any card. No fixture may surface it.
const NOTHING_CHECKED = 'produced no TS diagnostics';

async function parseFixture(name: string): Promise<ParseRealmResult> {
  let res = await runBoxel(['parse', '--json'], {
    cwd: resolve(FIXTURES_DIR, name),
  });
  return res.json<ParseRealmResult>();
}

// ---------------------------------------------------------------------------
// Primary behavior: glint actually runs against an npm install, and the
// resolution surfaces the CLI's tsconfig aliases cover type-check clean.
// ---------------------------------------------------------------------------
describe('boxel parse (against the installed CLI)', () => {
  it(
    'type-checks a card importing @cardstack/boxel-host/tools/* clean',
    async () => {
      // Exercises the post-rename host-tools path alias + the bundled
      // `tools/` source. Also proves glint ran end-to-end on a real card
      // in the installed layout.
      let result = await parseFixture('boxel-host-tools');
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
// Known typing gaps, deferred to follow-up work. These are card patterns
// that type-check clean in the monorepo (against host's real types) but
// not yet in a published install, because the bundled types / glint
// config don't cover them:
//
//   - runtime-common / field values: card-api resolves field value types
//     (`@model.someNumberField` → `number`) through the `primitive`
//     unique symbol imported from `@cardstack/runtime-common`. That
//     package is a devDependency, which `npm install` of the published
//     CLI does not install, so the mapping collapses to the field class
//     (`NumberField`). Fix: bundle runtime-common's generated types.
//   - decorators: `@tracked` alongside a `<template>` inside a
//     `static isolated = class … {}` expression trips glint's
//     "Decorators are not valid here". A glint/ember-tsc transform
//     limitation for decorators in class expressions.
//   - helper arg shapes: the bundled `formatDateTime` typing rejects the
//     common positional call `(formatDateTime @model.when 'MMM D')`.
//
// Marked `it.fails` so they run and stay red-as-expected without failing
// CI; when a fix lands, the test flips green and vitest reports the
// `it.fails` itself as failing — a tripwire to delete the marker and move
// the case up into the block above.
// ---------------------------------------------------------------------------
describe('boxel parse — known typing gaps (deferred)', () => {
  const DEFERRED = [
    'plain-glimmer',
    'runtime-common',
    'helpers-and-fields',
    'tracked-format-class',
  ];

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
