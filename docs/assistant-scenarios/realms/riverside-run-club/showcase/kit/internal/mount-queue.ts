// Pretui — the shared, bottom-first mount queue for heavy transcript bodies.
//
// A transcript renders its rows top to bottom, but the reader is at the
// bottom. Mounting every open tool body in document order makes the newest
// one (the one the reader is looking at) interactive last. So bodies are
// queued and mounted newest first: the queue is a stack, flushed after two
// animation frames (the first lets the rows themselves paint), one body per
// frame so no single frame pays for all of them.
//
// Cancelling marks an entry inactive instead of splicing it out, so a row
// that closes, or unmounts under virtualization, costs O(1) and the flush
// simply skips it.
//
// Timer-free: requestAnimationFrame only. Where it does not exist (the
// prerenderer), each mount runs on a microtask instead, so the prerendered
// output carries the mounted body and nothing waits on a frame that never
// comes. A microtask rather than a synchronous call, because the caller is
// usually mid-render and must not write tracked state there.
//
// Adapted from opencode `packages/session-ui/src/components/basic-tool.tsx`.

interface Entry {
  active: boolean;
  run: () => void;
}

const stack: Entry[] = [];
let frame: number | undefined;

function hasFrames(): boolean {
  return typeof requestAnimationFrame === 'function';
}

function flush() {
  while (stack.length > 0) {
    let entry = stack.pop()!;
    if (entry.active) {
      entry.active = false;
      frame = stack.length > 0 ? requestAnimationFrame(flush) : undefined;
      entry.run();
      return;
    }
  }
  frame = undefined;
}

function schedule() {
  if (frame !== undefined) {
    return;
  }
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(flush);
  });
}

/**
 * Queue `run` to mount a heavy body. Returns a cancel function; calling it
 * after `run` has happened is harmless.
 */
export function scheduleMount(run: () => void): () => void {
  let entry: Entry = { active: true, run };
  if (!hasFrames()) {
    queueMicrotask(() => {
      if (entry.active) {
        entry.active = false;
        entry.run();
      }
    });
  } else {
    stack.push(entry);
    schedule();
  }
  return () => {
    entry.active = false;
  };
}

/** How many mounts are still waiting. For tests and diagnostics. */
export function pendingMounts(): number {
  return stack.filter((entry) => entry.active).length;
}
