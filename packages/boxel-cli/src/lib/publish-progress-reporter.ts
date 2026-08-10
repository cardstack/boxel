import type { PublishProgress } from '@cardstack/runtime-common/realm-operations';
import { cliLog, isQuiet } from './cli-log.ts';
import { DIM, FG_CYAN, RESET } from './colors.ts';

// Publishing a large realm spends minutes indexing and then rendering, and the
// CLI has nothing to show for it. These renderers turn the progress readings
// `waitForReady` samples into terminal output.
//
// Everything here goes to stderr: `boxel realm publish --json` writes its result
// to stdout, and progress must never contaminate a stream a caller parses.

const PHASE_LABELS: Record<PublishProgress['phase'], string> = {
  // Enqueued with no worker on it. Named rather than folded into "Indexing" so
  // a backed-up or stalled queue doesn't look like a slow index.
  queued: 'Waiting for a worker',
  index: 'Indexing',
  render: 'Rendering',
  done: 'Finishing up',
};

// How finely the non-interactive renderer logs a pass. A publish reports
// roughly once a second for minutes, which would bury a CI log; tenths keep the
// shape of the progress in ~11 lines.
const LOG_STEPS_PER_PASS = 10;

// Cells in the interactive bar, and the floor it collapses at. Narrow enough to
// leave room for the label and counts on an 80-column terminal; below the floor
// the bar is dropped rather than squeezed into something unreadable.
const BAR_WIDTH = 24;
const MIN_COLUMNS_FOR_BAR = 60;

export interface PublishProgressReporter {
  onProgress: (progress: PublishProgress) => void;
  // Clears the in-place line an interactive run leaves behind, so whatever the
  // command prints next starts on a clean row. Safe to call when nothing was
  // written.
  finish: () => void;
}

interface OutputStream {
  write: (chunk: string) => unknown;
  isTTY?: boolean;
  // Terminal width, when the stream reports one. Absent on a stream that
  // isn't a terminal, and on some terminals that don't expose a size.
  columns?: number;
}

export function createPublishProgressReporter(
  // Injectable for tests; defaults to the real stderr.
  stream: OutputStream = process.stderr,
): PublishProgressReporter {
  return stream.isTTY ? interactiveReporter(stream) : nonInteractiveReporter();
}

function describe(progress: PublishProgress): string {
  let label = PHASE_LABELS[progress.phase];
  if (progress.phase === 'done' || progress.totalFiles === 0) {
    return `${label}…`;
  }
  return `${label} ${progress.filesCompleted} of ${progress.totalFiles} files…`;
}

// A determinate bar, drawn only where one can mean something: a pass that has
// reported a total, on a terminal wide enough to hold it alongside the counts.
// `colors.ts` blanks the escapes under NO_COLOR / non-TTY stdout, so this
// degrades to plain block characters rather than leaking escapes into a
// redirected stream.
function bar(progress: PublishProgress, columns: number | undefined): string {
  if (progress.totalFiles === 0 || progress.phase === 'done') {
    return '';
  }
  if (columns !== undefined && columns < MIN_COLUMNS_FOR_BAR) {
    return '';
  }
  let ratio = Math.min(progress.filesCompleted / progress.totalFiles, 1);
  let filled = Math.round(ratio * BAR_WIDTH);
  return `${FG_CYAN}${'█'.repeat(filled)}${RESET}${DIM}${'░'.repeat(
    BAR_WIDTH - filled,
  )}${RESET} `;
}

// Rewrites one line in place, the way a terminal user expects a progress
// indicator to behave.
function interactiveReporter(stream: OutputStream): PublishProgressReporter {
  let wroteLine = false;
  return {
    onProgress(progress) {
      if (isQuiet()) {
        return;
      }
      // `\x1b[2K` clears the whole row first: a shorter reading (fewer digits,
      // or a bar that just disappeared) would otherwise leave the tail of the
      // previous one on screen.
      stream.write(
        `\r\x1b[2K${bar(progress, stream.columns)}${describe(progress)}`,
      );
      wroteLine = true;
    },
    finish() {
      if (wroteLine) {
        stream.write('\r\x1b[2K');
        wroteLine = false;
      }
    },
  };
}

// Emits discrete lines for logs and pipes, throttled so a multi-minute publish
// doesn't produce hundreds of them.
function nonInteractiveReporter(): PublishProgressReporter {
  let lastPhase: PublishProgress['phase'] | undefined;
  let lastLoggedStep = -1;
  return {
    onProgress(progress) {
      // Integer arithmetic on the counts, not a ratio: binary floating point
      // can't hold tenths exactly, and comparing accumulated fractions drifts
      // the threshold a little further off with every step it logs.
      let step =
        progress.totalFiles > 0
          ? Math.floor(
              (progress.filesCompleted * LOG_STEPS_PER_PASS) /
                progress.totalFiles,
            )
          : 0;
      let phaseChanged = progress.phase !== lastPhase;
      if (phaseChanged) {
        // Each pass counts from zero, so the step gate restarts with it.
        lastLoggedStep = -1;
      }
      if (step <= lastLoggedStep) {
        return;
      }
      lastPhase = progress.phase;
      lastLoggedStep = step;
      cliLog.info(describe(progress));
    },
    finish() {},
  };
}
