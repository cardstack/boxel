import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PublishProgress } from '@cardstack/runtime-common/realm-operations';
import { createPublishProgressReporter } from '../../src/lib/publish-progress-reporter.ts';
import { setQuiet } from '../../src/lib/cli-log.ts';

// Publish progress arrives roughly once a second for the minutes a large realm
// takes. What that should look like depends entirely on where it is going: a
// terminal wants one line rewritten in place, a log wants a handful of discrete
// lines, and `--json` wants stdout left alone in both cases.

function fakeStream(isTTY: boolean) {
  let chunks: string[] = [];
  return {
    chunks,
    stream: {
      isTTY,
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
    },
  };
}

function progress(
  phase: PublishProgress['phase'],
  filesCompleted: number,
  totalFiles: number,
): PublishProgress {
  return { phase, filesCompleted, totalFiles };
}

describe('publish progress reporter', () => {
  let stderrChunks: string[];
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrChunks = [];
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
    setQuiet(false);
  });

  describe('interactive (TTY)', () => {
    it('rewrites a single line in place and clears it when finished', () => {
      let { chunks, stream } = fakeStream(true);
      let reporter = createPublishProgressReporter(stream);

      reporter.onProgress(progress('index', 10, 270));
      reporter.onProgress(progress('index', 20, 270));
      reporter.finish();

      expect(chunks).toEqual([
        '\r\x1b[2KIndexing 10 of 270 files…',
        '\r\x1b[2KIndexing 20 of 270 files…',
        '\r\x1b[2K',
      ]);
    });

    it('names the pass without counts before the job has reported', () => {
      let { chunks, stream } = fakeStream(true);
      let reporter = createPublishProgressReporter(stream);

      reporter.onProgress(progress('render', 0, 0));

      expect(chunks).toEqual(['\r\x1b[2KRendering…']);
    });

    // A publish whose job nothing has claimed produces no counts and never
    // will. Saying "Indexing" there would describe work that isn't happening.
    it('says the work is waiting for a worker when it is only queued', () => {
      let { chunks, stream } = fakeStream(true);
      let reporter = createPublishProgressReporter(stream);

      reporter.onProgress(progress('queued', 0, 0));

      expect(chunks).toEqual(['\r\x1b[2KWaiting for a worker…']);
    });

    it('writes nothing under --quiet', () => {
      let { chunks, stream } = fakeStream(true);
      let reporter = createPublishProgressReporter(stream);
      setQuiet(true);

      reporter.onProgress(progress('index', 10, 270));
      reporter.finish();

      expect(chunks).toEqual([]);
    });
  });

  describe('non-interactive', () => {
    // A reading a second for four minutes would bury a CI log, so the
    // non-interactive renderer only logs when the pass has moved appreciably.
    it('throttles to roughly a line per tenth of a pass', () => {
      let { stream } = fakeStream(false);
      let reporter = createPublishProgressReporter(stream);

      for (let completed = 0; completed <= 100; completed++) {
        reporter.onProgress(progress('index', completed, 100));
      }

      expect(stderrChunks).toEqual([
        'Indexing 0 of 100 files…\n',
        'Indexing 10 of 100 files…\n',
        'Indexing 20 of 100 files…\n',
        'Indexing 30 of 100 files…\n',
        'Indexing 40 of 100 files…\n',
        'Indexing 50 of 100 files…\n',
        'Indexing 60 of 100 files…\n',
        'Indexing 70 of 100 files…\n',
        'Indexing 80 of 100 files…\n',
        'Indexing 90 of 100 files…\n',
        'Indexing 100 of 100 files…\n',
      ]);
    });

    // Each pass counts from zero, so a phase change must always print even
    // though its completed count drops back below the last one logged.
    it('always logs a phase change', () => {
      let { stream } = fakeStream(false);
      let reporter = createPublishProgressReporter(stream);

      reporter.onProgress(progress('index', 90, 100));
      reporter.onProgress(progress('render', 1, 100));

      expect(stderrChunks).toEqual([
        'Indexing 90 of 100 files…\n',
        'Rendering 1 of 100 files…\n',
      ]);
    });

    it('writes nothing under --quiet', () => {
      let { stream } = fakeStream(false);
      let reporter = createPublishProgressReporter(stream);
      setQuiet(true);

      reporter.onProgress(progress('index', 10, 270));

      expect(stderrChunks).toEqual([]);
    });
  });
});
