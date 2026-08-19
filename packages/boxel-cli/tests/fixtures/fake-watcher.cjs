// Fixture used by tests/integration/realm-watch-stop.test.ts.
// Spawns a long-running process that optionally registers itself in the
// watch-process registry and handles SIGINT/SIGTERM by unregistering and
// exiting cleanly — mimicking what a real `realm watch start` does on
// shutdown.

// Node (>=22.18 / 24) strips TypeScript types natively, so the registry .ts
// loads via a plain require with no extra loader.
const path = require('path');
const registry = require(
  path.resolve(
    __dirname,
    '..',
    '..',
    'src',
    'lib',
    'watch-process-registry.ts',
  ),
);

async function main() {
  const workspace = process.env.WATCHER_WORKSPACE || '/tmp/fake-watcher';

  if (process.env.DO_REGISTER !== 'false') {
    await registry.registerProcess(workspace);
  }

  let exiting = false;
  const cleanup = async () => {
    if (exiting) return;
    exiting = true;
    try {
      await registry.unregisterCurrentProcess();
    } catch {
      // best effort
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void cleanup());
  process.on('SIGTERM', () => void cleanup());

  // Tell the parent we're ready (registered + signal handlers installed).
  if (process.send) {
    process.send('ready');
  } else {
    process.stdout.write('FAKE_WATCHER_READY\n');
  }

  // Idle until signaled.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
