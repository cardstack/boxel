// Opt-in: when BOXEL_WTFNODE=1, dump the active handles / requests / timers
// on SIGINT/SIGTERM, and again 5s later. The 5s-later dump is the useful
// one for "node didn't exit after Ctrl-C" investigation: anything still
// listed by then is what is preventing the event loop from draining.
//
// Import this for side effects at the top of each node entry point.

import { createRequire } from 'module';

if (process.env.BOXEL_WTFNODE === '1') {
  // `require` doesn't exist in ESM scope; recreate it for this lazy, opt-in load.
  const require = createRequire(import.meta.url);
  const wtfnode = require('wtfnode');
  const tag =
    (process.argv[1] || 'node').split('/').pop() + `(pid=${process.pid})`;

  const dump = (label: string) => {
    process.stderr.write(`\n[wtfnode ${tag}] ${label}\n`);
    try {
      wtfnode.dump();
    } catch (err) {
      process.stderr.write(`[wtfnode ${tag}] dump failed: ${String(err)}\n`);
    }
  };

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      dump(`dump on ${sig}`);
      // .unref() so the timer itself doesn't keep the event loop alive.
      setTimeout(() => dump(`dump 5s after ${sig}`), 5000).unref();
    });
  }
}
