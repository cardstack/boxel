import './setup-localhost-resolver';
import { makeLogDefinitions } from '@cardstack/runtime-common';
(globalThis as any)._logDefinitions = makeLogDefinitions(
  process.env.LOG_LEVELS || '*=info',
);

// In dev and CI these services run with stdout/stderr piped (run-p, the
// dev-log-tee per-service files, the CI `| tee server.log`). Node
// block-buffers writes to a pipe and flushes the remainder only when the
// process exits, so a process that hangs prints nothing until teardown and
// then dumps everything at once with teardown timestamps — which hides
// where it actually stalled. Putting the handles in blocking mode makes
// each write flush immediately, the way a TTY already does. Scoped to
// development (the mode the mise service tasks run under) so production
// keeps async writes, where a blocking stdout could stall the event loop
// if the log reader backs up.
if (process.env.NODE_ENV === 'development') {
  for (let stream of [process.stdout, process.stderr]) {
    let handle = (stream as any)._handle;
    if (handle && typeof handle.setBlocking === 'function') {
      handle.setBlocking(true);
    }
  }
}
