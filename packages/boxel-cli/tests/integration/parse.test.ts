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
// "pass" that never actually type-checked. No fixture may surface this.
const NOTHING_CHECKED = 'produced no TS diagnostics';

async function parseFixture(name: string): Promise<ParseRealmResult> {
  let res = await runBoxel(['parse', '--json'], {
    cwd: resolve(FIXTURES_DIR, name),
  });
  return res.json<ParseRealmResult>();
}

// Cards that must type-check clean once parse works against an npm
// install. Each targets a resolution surface the CLI's bundled types /
// tsconfig aliases have to cover.
const CLEAN_FIXTURES: { name: string; covers: string }[] = [
  {
    name: 'plain-glimmer',
    covers: '@glimmer/component + @tracked + contains(NumberField)',
  },
  {
    name: 'tracked-format-class',
    covers: '@tracked inside a static isolated format class',
  },
  { name: 'runtime-common', covers: 'bare @cardstack/runtime-common import' },
  { name: 'boxel-host-tools', covers: '@cardstack/boxel-host/tools/* import' },
  {
    name: 'helpers-and-fields',
    covers: 'positional formatDateTime + field interpolation',
  },
];

describe('boxel parse (against the installed CLI)', () => {
  describe.each(CLEAN_FIXTURES)('$name — $covers', ({ name }) => {
    it(
      'type-checks clean',
      async () => {
        let result = await parseFixture(name);
        // Surface the actual diagnostics on failure instead of a bare
        // count mismatch.
        expect(result.errors).toEqual([]);
        expect(result.status).toBe('passed');
        expect(result.filesChecked).toBeGreaterThanOrEqual(1);
      },
      { timeout: 180_000 },
    );
  });

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
      // message that masks a broken type-resolution setup as errors.
      expect(messages).not.toContain(NOTHING_CHECKED);
    },
    { timeout: 180_000 },
  );
});
