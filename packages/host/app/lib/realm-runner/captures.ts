import {
  UPLOAD_RESERVE_MS,
  type ViewedImage,
  type ViewOptions,
} from '../visual-capture';

// The host half of `realm.capture`: the captures one run takes, within the
// run's own time limit, and how many it may take. Each capture is attached to
// the run's tool result as an image; the script gets back only what it needs
// to carry on.

// How many captures one run may attach with `realm.capture`.
const MAX_CAPTURES = 3;
// A capture must finish this long before the run's own time limit, so the
// script still has time to use what it saw and return.
const CAPTURE_MARGIN_MS = 3_000;
// A capture started with less time than this left before its own deadline is
// refused: the capture needs a few seconds after the upload reserve. An
// admitted capture is bounded: its card probe has a short timeout of its own,
// its capture request is aborted at its deadline, and ending the run stops
// every step that waits.
const MIN_CAPTURE_BUDGET_MS = UPLOAD_RESERVE_MS + 5_000;

// Captures one realm URL and uploads the image, done by `doneBy`, or stopped
// when `signal` aborts.
export type CaptureURL = (
  url: string,
  options: ViewOptions,
  doneBy: number,
  signal: AbortSignal,
) => Promise<ViewedImage>;

export class RealmCaptures {
  // The captures taken, in the order they were taken.
  readonly taken: ViewedImage[] = [];
  // When the script's own time limit runs out; set as the run starts.
  runEndsAt = Number.POSITIVE_INFINITY;
  // Captures dropped because the run had ended while they were in flight.
  refusedAfterClose = 0;
  private closed = false;
  // Aborted when the run ends, so a capture still in flight stops there rather
  // than uploading after the tool has reported.
  private inFlight = new AbortController();

  constructor(private captureURL: CaptureURL) {}

  close() {
    this.closed = true;
    this.inFlight.abort();
  }

  // `url` is the realm URL to capture, already resolved inside the run's
  // realm; `path` is how the script named it.
  async take(url: string, path: string, rawOptions: unknown) {
    if (this.taken.length >= MAX_CAPTURES) {
      throw new Error(
        `realm.capture may run at most ${MAX_CAPTURES} times in one run; use the view-visually tool for more`,
      );
    }
    let doneBy = this.runEndsAt - CAPTURE_MARGIN_MS;
    if (doneBy - Date.now() < MIN_CAPTURE_BUDGET_MS) {
      throw new Error(
        `Not enough time left in this run to capture ${url}; use the view-visually tool instead`,
      );
    }
    let viewed = await this.captureURL(
      url,
      captureOptions(rawOptions),
      doneBy,
      this.inFlight.signal,
    );
    if (this.closed) {
      this.refusedAfterClose += 1;
      throw new Error(`The run has ended; the capture of ${url} was dropped`);
    }
    this.taken.push(viewed);
    return {
      path,
      kind: viewed.kind,
      format: viewed.format,
      width: viewed.width ?? null,
      height: viewed.height ?? null,
      ...(viewed.note ? { note: viewed.note } : {}),
      attached: true,
    };
  }
}

// The options a script may pass to `realm.capture`, taken field by field so
// nothing else reaches the capture.
function captureOptions(raw: unknown): ViewOptions {
  let options = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    ...(typeof options.format === 'string'
      ? { format: options.format as ViewOptions['format'] }
      : {}),
    ...(typeof options.viewportWidth === 'number'
      ? { viewportWidth: options.viewportWidth }
      : {}),
    ...(typeof options.viewportHeight === 'number'
      ? { viewportHeight: options.viewportHeight }
      : {}),
    ...(options.fullPage === true ? { fullPage: true } : {}),
  };
}
