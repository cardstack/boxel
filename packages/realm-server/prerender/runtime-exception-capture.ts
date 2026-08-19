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
//     • thrown + revoked      → V8 retracted the uncaught status (a
//                               late `.catch` got attached
//                               downstream — typically RSVP /
//                               Backburner / Ember runloop). We
//                               still surface the entry — render-
//                               runner tags the title with
//                               "(revoked by late .catch)" so the
//                               lifecycle is visible to operators.
//
//   An earlier iteration of this module discarded revoked entries
//   as "transient noise". That turned out to be wrong: the
//   whitepaper-class render bug fits the revoked pattern exactly
//   (RSVP swallows the rejection so `unhandledrejection` never
//   fires; Glimmer's render tree is still poisoned), and dropping
//   them was actively discarding the actionable stack we'd
//   captured. The render either way ends up in error state, and
//   `additionalErrors` is only attached to error docs, so the
//   noise risk is bounded.
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

import type { CDPSession, Page } from 'puppeteer';
import { logger } from '@cardstack/runtime-common';
import type { ConsoleErrorEntry, ConsoleErrorLocation } from './page-pool.ts';

const log = logger('prerenderer');
const chromeLog = logger('prerenderer-chrome');

// Local subset of CDP `Runtime.*` event payloads. We deliberately
// don't import `devtools-protocol` (it's a transitive dep of
// puppeteer, not a direct one) — declaring just what we use keeps
// the type surface small and the import graph honest. The full
// shapes are documented at:
//   https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
interface CdpRemoteObject {
  // For thrown Errors, `description` typically carries the full
  // toString-style "Error: <message>\n    at ..." dump — far more
  // actionable than the bare label CDP puts in `exceptionDetails.text`
  // (which is often just "Uncaught" / "Uncaught (in promise)").
  description?: string;
  // Captured when the exception is a primitive (string, number, etc.)
  // — RemoteObject.value carries the literal. Rare for real bugs but
  // we surface it as a fallback rather than emit "Uncaught" with no
  // payload.
  value?: unknown;
}
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
  // Present whenever V8 has a live exception object handle. For
  // thrown Errors this is the actual Error instance, and its
  // `description` field is what we want for the surfaced message.
  exception?: CdpRemoteObject;
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
  // exceptionId-to-storage-key mapping internally so that a later
  // `recordRevoked(exceptionId)` can find and tag the matching
  // entry. Returning false signals storage was at limit (e.g.
  // CONSOLE_ERROR_LIMIT exceeded); when that happens the recorder
  // must NOT retain any tracking for this exceptionId, so a
  // follow-up revocation is a clean no-op rather than a phantom
  // tag.
  recordThrown: (exceptionId: number, entry: ConsoleErrorEntry) => boolean;
  // Called once per Runtime.exceptionRevoked. The recorder finds
  // the entry it stored for this exceptionId (if any) and tags it
  // as revoked — it stays in the bucket so render-runner can
  // surface it on the error doc with a `(revoked by late .catch)`
  // marker. No-op if recordThrown was never called for this id,
  // or if it returned false (storage was at limit).
  recordRevoked: (exceptionId: number) => void;
}

export interface AttachRuntimeExceptionCaptureOptions {
  page: Page;
  // Resolved lazily at log-emit time so that pages whose affinity
  // changes after attach (standby → real-affinity adoption, or one
  // affinity → another via re-tagging) carry the CURRENT affinity in
  // their log lines, not the value frozen when the CDP session was
  // first attached. Caller is responsible for keeping the resolved
  // value in sync with the page's lifecycle.
  getAffinityKey: () => string;
  pageId: string;
  recorder: RuntimeExceptionRecorder;
}

export async function attachRuntimeExceptionCapture(
  opts: AttachRuntimeExceptionCaptureOptions,
): Promise<void> {
  let { page, getAffinityKey, pageId, recorder } = opts;
  let client: CDPSession;
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
      getAffinityKey(),
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
      // Logged at debug, not error: V8 fires this for every uncaught
      // throw including the ones RSVP / Backburner catch a microtask
      // later (now tagged `revoked: true` rather than dropped, but
      // still common). Logging at error would flood production logs
      // with transient late-catch noise. The actual surfaced
      // exceptions reach the error doc via `additionalErrors`;
      // that's the operator-facing signal. If you want raw V8
      // visibility, enable `prerenderer-chrome` at debug.
      chromeLog.debug(
        'Runtime.exceptionThrown affinity=%s pageId=%s exceptionId=%s text=%s',
        getAffinityKey(),
        pageId,
        details.exceptionId,
        entry.text,
      );
    } catch (e) {
      log.debug(
        'Failed to record Runtime.exceptionThrown for affinity %s page %s:',
        getAffinityKey(),
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
        getAffinityKey(),
        pageId,
        event.exceptionId,
        event.reason,
      );
    } catch (e) {
      log.debug(
        'Failed to process Runtime.exceptionRevoked for affinity %s page %s:',
        getAffinityKey(),
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
  let stackFrames = extractStackFrames(details);
  return {
    type: 'error',
    // Pass `stackFrames !== undefined` so the message extraction can
    // strip a redundant inline stack from `description` (which V8
    // includes verbatim) when the same frames are about to land in
    // the SerializedError's separate `stack` field.
    text: extractExceptionMessage(details, stackFrames !== undefined),
    location,
    stackFrames,
    source: 'exception',
  };
}

function extractStackFrames(
  details: CdpExceptionDetails,
): ConsoleErrorLocation[] | undefined {
  let frames = details.stackTrace?.callFrames;
  if (!Array.isArray(frames) || frames.length === 0) return undefined;
  let usable = frames
    .filter((frame) => !!frame?.url)
    .map((frame) => ({
      url: frame.url,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
    }));
  return usable.length > 0 ? usable : undefined;
}

// Picks the most actionable text we can extract from a CDP
// ExceptionDetails payload. The `text` field is frequently a generic
// label like "Uncaught" or "Uncaught (in promise)" — useful for
// classifying but useless on its own. The actual error message lives
// on the `exception` RemoteObject:
//
//   • `exception.description` is the V8-side toString of the live
//     exception object. For thrown Errors this looks like
//     `"TypeError: ...\n    at frame1\n    at frame2"` — header line
//     + an inline stack. When we ALSO have CDP `stackTrace.callFrames`
//     to populate the SerializedError's separate `stack` field, we
//     keep just the header line so the surfaced `message` and `stack`
//     stay cleanly separated (and `#formatConsoleError` doesn't append
//     a location suffix after an embedded stack). When there's no
//     separate stack field, we keep the full description so the only
//     stack info we have isn't dropped on the floor.
//   • `exception.value` is set when the thrown value is a primitive
//     (e.g. `throw 'boom'` or `throw 42`). Stringify as a fallback.
//
// Preference order: description → value → text → "Uncaught exception".
// We always fall back to *something* non-empty so the surfaced error
// doc never carries an entry with a blank message.
function extractExceptionMessage(
  details: CdpExceptionDetails,
  stackInOwnField: boolean,
): string {
  let exception = details.exception;
  if (exception) {
    if (typeof exception.description === 'string' && exception.description) {
      if (stackInOwnField) {
        // Header-only: split on \n and keep the first line. This
        // matches Error.toString() format ("TypeError: foo") and
        // drops the redundant "    at ..." frames that V8 baked in.
        let firstLineEnd = exception.description.indexOf('\n');
        return firstLineEnd === -1
          ? exception.description
          : exception.description.slice(0, firstLineEnd);
      }
      return exception.description;
    }
    if (exception.value !== undefined && exception.value !== null) {
      try {
        return String(exception.value);
      } catch {
        // String() on a value with a custom Symbol.toPrimitive that
        // throws — fall through to the text/default path.
      }
    }
  }
  return details.text || 'Uncaught exception';
}
