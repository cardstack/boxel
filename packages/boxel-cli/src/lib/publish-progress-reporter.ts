import type { PublishProgress } from '@cardstack/runtime-common/realm-operations';
import { cliLog, isQuiet } from './cli-log.ts';

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

export interface PublishProgressReporter {
  onProgress: (progress: PublishProgress) => void;
  // Clears the in-place line an interactive run leaves behind, so whatever the
  // command prints next starts on a clean row. Safe to call when nothing was
  // written.
  finish: () => void;
}

export function createPublishProgressReporter(
  // Injectable for tests; defaults to the real stderr.
  stream: {
    write: (chunk: string) => unknown;
    isTTY?: boolean;
  } = process.stderr,
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

// Rewrites one line in place, the way a terminal user expects a progress
// indicator to behave.
function interactiveReporter(stream: {
  write: (chunk: string) => unknown;
  isTTY?: boolean;
}): PublishProgressReporter {
  let wroteLine = false;
  return {
    onProgress(progress) {
      if (isQuiet()) {
        return;
      }
      // `\x1b[2K` clears the whole row first: a shorter reading (fewer digits)
      // would otherwise leave the tail of the previous one on screen.
      stream.write(`\r\x1b[2K${describe(progress)}`);
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
