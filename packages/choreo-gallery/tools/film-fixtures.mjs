/**
 * THE GOLDEN FIXTURES. A film is its cue table and its camera path; this
 * writes both, for every reference film, from the same pure schedule the
 * engine runs (`packages/glimmer-motion/src/film/schedule.ts`) and the
 * same data the component renders (`packages/choreo-test-app/app/lib/films/*.ts`).
 *
 * The refactor of the film onto the graph is measured against these:
 * `tests/unit/film-schedule-test.ts` recomputes the schedule in the
 * browser and asserts it equals the committed JSON to the digit. Change a
 * number here and you have changed the film; a phase that means to is a
 * phase that re-runs this script and reviews the diff.
 *
 *   node scripts/film-fixtures.mjs          # writes tests/fixtures/film/*.json
 *   node scripts/film-fixtures.mjs --check  # exits 1 if any fixture would change
 *
 * Runs on Node's own type stripping: the schedule and the data modules
 * are plain TypeScript with erasable types and no Ember in them, and the
 * one runtime import (`hex`, `RAD`) comes from the library's pure math
 * subpath, so nothing here needs a build.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = resolve(root, 'packages/choreo-test-app/tests/fixtures/film');
const check = process.argv.includes('--check');

const { schedule } = await import(
  resolve(root, 'packages/glimmer-motion/src/film/schedule.ts')
);

/** each film: its data module, and the seam it gives a beat that names none */
const FILMS = [
  ['sagrada', 'dip'],
  ['towers', 'wipe'],
];

let changed = 0;
mkdirSync(out, { recursive: true });
for (const [name, join] of FILMS) {
  const data = await import(
    resolve(root, `packages/choreo-test-app/app/lib/films/${name}.ts`)
  );
  const s = schedule(data.BEATS, data.CHAPTERS, join);
  const json = JSON.stringify(s, null, 2) + '\n';
  const file = resolve(out, `${name}.json`);
  let prev = '';
  try {
    prev = readFileSync(file, 'utf8');
  } catch {
    /* first run */
  }
  if (prev === json) {
    console.log(
      `${name}: unchanged (${s.beats.length} beats, ${s.waypoints.length} waypoints, ${s.total}s)`,
    );
    continue;
  }
  changed += 1;
  if (check) {
    console.error(`${name}: the schedule differs from ${file}`);
  } else {
    writeFileSync(file, json);
    console.log(
      `${name}: wrote ${file} (${s.beats.length} beats, ${s.waypoints.length} waypoints, ${s.total}s)`,
    );
  }
}
if (check && changed) {
  process.exitCode = 1;
}
