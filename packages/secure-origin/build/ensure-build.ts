// Leaves `dist/` holding a build of the sources on disk. A build that still
// matches every file it was made from is kept as it is. Otherwise, with no
// build, no record of its inputs, or an input that has changed, this runs
// `pnpm build` and exits with its status.
//
// The deployed start scripts run this before the realm server, which reads
// the build once, at startup, and refuses to start without one. The image
// already holds a build of its own sources, so a container normally starts
// without building. One whose build is missing or doesn't match still gets a
// fresh build, however the image was made.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { staleInput } from './build-inputs.ts';
import { PACKAGE_ROOT } from './module-package.ts';

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
