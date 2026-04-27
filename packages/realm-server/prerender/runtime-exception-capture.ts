// V8-layer uncaught-exception capture for prerender pages.
//
// Why this module exists:
//
//   The render route's existing error handlers (window.error,
//   unhandledrejection, RSVP.on('error')) cannot observe a class of
//   render failures we've seen in production — most notably the
//   whitepaper render path, where a card's template throws and the
//   Ember runloop catches the exception in a way that no JS-level
//   event ever fires. Chrome's "Pause on uncaught exceptions"
//   debugger flag DOES fire for this bug, which means V8 sees the
//   throw — it's the WebAPI dispatch layer that misses it.
//
//   The reason for the gap: V8 reports an uncaught exception at
//   throw time (debugger pause + "Uncaught (in promise) ..." console
//   log). The matching `unhandledrejection` event dispatches LATER,
//   on the next microtask checkpoint, only if no handler attached
//   in between. RSVP / Backburner / Ember frequently auto-attach a
//   late `.catch` to rejecting promises during their flush, and V8
//   then RETRACTS the exception's "uncaught" status. The result:
//
//     ✅ Debugger pause fires
//     ✅ Console gets "Uncaught (in promise) ..."
//     ❌ unhandledrejection never dispatches
//     ❌ RSVP.on('error') never fires
//     ❌ Glimmer's render tree is poisoned regardless
//
// What this module captures:
//
//   `Runtime.exceptionThrown` is V8's notification AT THE FIRST
//   layer (the same one the debugger hooks), and
//   `Runtime.exceptionRevoked` fires when V8 later retracts an
//   exception's uncaught status. Tracking exceptionId across both
//   events lets us distinguish:
//
//     • thrown + not revoked  → genuine uncaught exception, surface
//                               it as a real error signal.
//     • thrown + revoked      → silently caught upstream (the RSVP
//                               late-`.catch` case above) — drop it
//                               so we don't swamp the error doc with
//                               transient noise.
//
// Lifecycle:
//
//   `attachRuntimeExceptionCapture` creates a per-page CDP session
//   and wires up the listeners. Puppeteer auto-detaches the session
//   when the page closes, so no explicit teardown is needed here.
//   The exceptionId-to-entry mapping is owned by the supplied
//   `RuntimeExceptionRecorder` (typically PagePool, which clears
//   it in lockstep with `resetConsoleErrors` / page disposal) —
//   keeping that state out of this module avoids a slow leak on
//   long-lived pages where many thrown exceptions never get revoked.
//
//   Failures during attach (race with page teardown, transient CDP
//   errors) are logged at debug level and the function resolves
//   without throwing; this is best-effort observability and must
//   not break the render path.

import type { Page } from 'puppeteer';
import { logger } from '@cardstack/runtime-common';
import type { ConsoleErrorEntry, ConsoleErrorLocation } from './page-pool';

const log = logger('prerenderer');
const chromeLog = logger('prerenderer-chrome');

// Local subset of CDP `Runtime.*` event payloads. We deliberately
// don't import `devtools-protocol` (it's a transitive dep of
// puppeteer, not a direct one) — declaring just what we use keeps
// the type surface small and the import graph honest. The full
// shapes are documented at:
//   https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
interface CdpExceptionDetails {
  exceptionId: number;
  text: string;
  lineNumber: number;
  columnNumber: number;
  url?: string;
  stackTrace?: {
    callFrames: Array<{
      url: string;
      lineNumber: number;
      columnNumber: number;
    }>;
  };
}
interface CdpExceptionThrownEvent {
  timestamp: number;
  exceptionDetails: CdpExceptionDetails;
}
interface CdpExceptionRevokedEvent {
  reason: string;
  exceptionId: number;
}

export interface RuntimeExceptionRecorder {
  // Called once per Runtime.exceptionThrown. The recorder owns the
  // exceptionId-to-storage-key mapping internally so that on a later
  // `recordRevoked(exceptionId)` it can find and remove the matching
  // entry. Returning false signals storage was at limit (e.g.
  // CONSOLE_ERROR_LIMIT exceeded); when that happens the recorder
  // must NOT retain any tracking for this exceptionId, so a follow-
  // up revocation is a clean no-op rather than a phantom remove.
  recordThrown: (exceptionId: number, entry: ConsoleErrorEntry) => boolean;
  // Called once per Runtime.exceptionRevoked. The recorder finds the
  // entry it stored for this exceptionId (if any) and removes it.
  // No-op if recordThrown was never called for this id, or if it
  // returned false (storage was at limit).
  recordRevoked: (exceptionId: number) => void;
}

export interface AttachRuntimeExceptionCaptureOptions {
  page: Page;
  affinityKey: string;
  pageId: string;
  recorder: RuntimeExceptionRecorder;
}

export async function attachRuntimeExceptionCapture(
  opts: AttachRuntimeExceptionCaptureOptions,
): Promise<void> {
  let { page, affinityKey, pageId, recorder } = opts;
  let client;
  try {
    client = await page.createCDPSession();
    // Register listeners BEFORE awaiting `Runtime.enable` so we don't
    // miss any exceptions delivered in the (small) window between
    // enable arriving at V8 and the local handler being subscribed.
    client.on('Runtime.exceptionThrown', onExceptionThrown);
    client.on('Runtime.exceptionRevoked', onExceptionRevoked);
    await client.send('Runtime.enable');
  } catch (e) {
    // CDP session creation can race with page teardown — best-effort.
    log.debug(
      'Failed to attach Runtime.exceptionThrown listener for affinity %s page %s:',
      affinityKey,
      pageId,
      e,
    );
    return;
  }

  function onExceptionThrown(event: CdpExceptionThrownEvent): void {
    try {
      let details = event.exceptionDetails;
      if (!details) return;
      let entry = toConsoleErrorEntry(details);
      recorder.recordThrown(details.exceptionId, entry);
      chromeLog.error(
        'Runtime.exceptionThrown affinity=%s pageId=%s exceptionId=%s text=%s',
        affinityKey,
        pageId,
        details.exceptionId,
        entry.text,
      );
    } catch (e) {
      log.debug(
        'Failed to record Runtime.exceptionThrown for affinity %s page %s:',
        affinityKey,
        pageId,
        e,
      );
    }
  }

  function onExceptionRevoked(event: CdpExceptionRevokedEvent): void {
    try {
      recorder.recordRevoked(event.exceptionId);
      chromeLog.debug(
        'Runtime.exceptionRevoked affinity=%s pageId=%s exceptionId=%s reason=%s',
        affinityKey,
        pageId,
        event.exceptionId,
        event.reason,
      );
    } catch (e) {
      log.debug(
        'Failed to process Runtime.exceptionRevoked for affinity %s page %s:',
        affinityKey,
        pageId,
        e,
      );
    }
  }
}

// Translates a CDP `Runtime.ExceptionDetails` payload into the same
// `ConsoleErrorEntry` shape used by the console-error capture path,
// so downstream serialisation in render-runner is identical for both
// signals (with `source: 'exception'` distinguishing the layer).
function toConsoleErrorEntry(details: CdpExceptionDetails): ConsoleErrorEntry {
  let location: ConsoleErrorLocation | undefined = details.url
    ? {
        url: details.url,
        lineNumber: details.lineNumber,
        columnNumber: details.columnNumber,
      }
    : undefined;
  let frames = details.stackTrace?.callFrames;
  let stackFrames: ConsoleErrorLocation[] | undefined =
    Array.isArray(frames) && frames.length > 0
      ? frames
          .filter((frame) => !!frame?.url)
          .map((frame) => ({
            url: frame.url,
            lineNumber: frame.lineNumber,
            columnNumber: frame.columnNumber,
          }))
      : undefined;
  return {
    type: 'error',
    text: details.text || 'Uncaught exception',
    location,
    stackFrames,
    source: 'exception',
  };
}
