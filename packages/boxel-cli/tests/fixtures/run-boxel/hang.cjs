// A stand-in CLI that never exits and ignores SIGTERM, so the harness has to
// escalate to SIGKILL to get rid of it — the same shape as a `boxel` command
// wedged inside its own signal handler.
//
// With RUN_BOXEL_READY_FILE set it touches that path once it is running, so a
// test can wait on a live child instead of a fixed sleep.
const fs = require('node:fs');

process.on('SIGTERM', () => {
  console.log('ignoring SIGTERM');
});
console.log(`hang.cjs started with args: ${process.argv.slice(2).join(' ')}`);
if (process.env.RUN_BOXEL_READY_FILE) {
  fs.writeFileSync(process.env.RUN_BOXEL_READY_FILE, 'ready');
}
setInterval(() => {}, 1_000);
