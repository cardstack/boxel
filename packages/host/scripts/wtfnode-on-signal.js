// Opt-in: when BOXEL_WTFNODE=1, dump the active handles / requests / timers
// on SIGINT/SIGTERM, and again 5s later. The 5s-later dump is the useful
// one for "node didn't exit after Ctrl-C" investigation: anything still
// listed by then is what is preventing the event loop from draining.
//
// require() this for side effects at the top of each node entry point in
// this package (e.g. scripts/vite-with-traefik.js, scripts/vite-serve.js).

if (process.env.BOXEL_WTFNODE === '1') {
  const wtfnode = require('wtfnode');
  const tag =
    (process.argv[1] || 'node').split('/').pop() + `(pid=${process.pid})`;

  const dump = (label) => {
    process.stderr.write(`\n[wtfnode ${tag}] ${label}\n`);
    try {
      wtfnode.dump();
    } catch (err) {
      process.stderr.write(`[wtfnode ${tag}] dump failed: ${String(err)}\n`);
    }
  };

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      dump(`dump on ${sig}`);
      setTimeout(() => dump(`dump 5s after ${sig}`), 5000).unref();
    });
  }
}
