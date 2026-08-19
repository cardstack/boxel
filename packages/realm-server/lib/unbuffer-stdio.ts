// Put stdout/stderr in blocking mode under NODE_ENV=development so service
// processes (and dev-only startup probes that share their pipe topology)
// flush each write immediately to a piped consumer — run-p, dev-log-tee,
// CI's `| tee server.log` — the way a TTY already does. Node block-buffers
// writes to a pipe and flushes the remainder only when the process exits,
// so a process that hangs prints nothing until teardown and then dumps
// everything at once with teardown timestamps, hiding where it actually
// stalled.
//
// Side-effect module: importing it is the contract. Production keeps async
// writes — a blocking stdout there could stall the event loop if the log
// reader backs up.
if (process.env.NODE_ENV === 'development') {
  for (let stream of [process.stdout, process.stderr]) {
    let handle = (stream as any)._handle;
    if (handle && typeof handle.setBlocking === 'function') {
      handle.setBlocking(true);
    }
  }
}
