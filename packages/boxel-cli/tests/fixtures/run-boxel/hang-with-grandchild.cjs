// A stand-in CLI that spawns a grandchild inheriting its stdio and then hangs
// — the shape of `boxel parse` running ember-tsc, or `boxel test` launching
// chromium. The command only reports `close` once every inherited pipe is
// released, so signalling the command alone leaves the caller waiting on a
// grandchild nothing has killed.
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');

spawn(process.execPath, [resolve(__dirname, 'hang.cjs'), 'grandchild'], {
  stdio: 'inherit',
});
console.log('parent started');
setInterval(() => {}, 1_000);
