// TEMPORARY: CI hammer for the v8-prof mtime race. Not for merge.
// Repeats the test's beforeEach + "selects the largest this-run log" body
// many times in one process and counts iterations where the fresh logs were
// dropped as stale. Run against the unfixed copy (control) and the fix.
import { promises as fs } from 'fs';
import path from 'path';

let which = process.argv[2] ?? 'fixed';
let iterations = Number(process.argv[3] ?? 3000);
let mod =
  which === 'control'
    ? await import('../../prerender/v8-prof-control.ts')
    : await import('../../prerender/v8-prof.ts');

process.env.PRERENDER_V8_PROF = 'true';
delete process.env.PRERENDER_ARTIFACTS_BUCKET;

let failures = 0;
let examples: string[] = [];
for (let i = 0; i < iterations; i++) {
  await mod.prepareV8ProfForLaunch();
  let small = path.join(
    mod.V8_PROF_LOG_DIR,
    `isolate-0xaaa-${mod.V8_PROF_LOG_PREFIX}101.log`,
  );
  let big = path.join(
    mod.V8_PROF_LOG_DIR,
    `isolate-0xbbb-${mod.V8_PROF_LOG_PREFIX}102.log`,
  );
  await fs.writeFile(small, Buffer.alloc(4096, 'v'));
  await fs.writeFile(big, Buffer.alloc(64 * 1024, 'v'));
  let status =
    (await mod.uploadV8ProfLog({ realm: 'r', card: 'c', step: 's' })) ?? '';
  if (!status.includes('kept local') || !status.includes(path.basename(big))) {
    failures++;
    if (examples.length < 3) {
      examples.push(status);
    }
  }
  await fs.rm(small, { force: true });
  await fs.rm(big, { force: true });
}
console.log(
  `HAMMER ${which}: ${failures}/${iterations} iterations failed (${((100 * failures) / iterations).toFixed(2)}%)`,
);
for (let e of examples) {
  console.log(`  example: ${e}`);
}
if (which !== 'control' && failures > 0) {
  process.exitCode = 1;
}
