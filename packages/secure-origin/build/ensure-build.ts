// Leaves `dist/` holding a whole build of the sources on disk. A build whose
// record still matches every file it was made from and every file it wrote
// is kept as it is. Otherwise, with no build, no record, or an input or
// output that is missing or has changed, this runs `pnpm build` and exits
// with its status.
//
// The deployed start scripts run this before the realm server, which reads
// the build once, at startup, and refuses to start without one. The image
// already holds a build of its own sources, so a container normally starts
// without building. One whose build is missing or doesn't match still gets a
// fresh build, however the image was made.
//
// `--check <dir>` builds nothing: it exits 1, naming the reason, when the
// build in `<dir>` would not be kept. `pnpm lint:build` runs it on the build
// it has just made, so a build that stops writing a record this accepts
// fails CI rather than rebuilding on every container start.
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { staleInput } from './build-inputs.ts';
import { PACKAGE_ROOT } from './module-package.ts';

let [flag, dir] = process.argv.slice(2);
if (flag === '--check') {
  if (!dir) {
    console.error('usage: ensure-build.ts [--check <dist dir>]');
    process.exit(2);
  }
  let reason = staleInput(resolve(PACKAGE_ROOT, dir));
  if (reason !== undefined) {
    console.error(
      `secure origin: the build in ${dir} would be rebuilt at startup, because ${reason}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

let started = Date.now();
let reason = staleInput(join(PACKAGE_ROOT, 'dist'));
if (reason === undefined) {
  console.log(
    `secure origin: dist/ matches its sources, checked in ${Date.now() - started} ms`,
  );
  process.exit(0);
}

console.log(`secure origin: building, because ${reason}`);
let { status, error } = spawnSync('pnpm', ['build'], {
  cwd: PACKAGE_ROOT,
  stdio: 'inherit',
});
if (error) {
  console.error(error);
}
process.exit(status ?? 1);
