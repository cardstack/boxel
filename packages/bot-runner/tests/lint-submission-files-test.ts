import QUnit from 'qunit';
const { module, test } = QUnit;
import type { LintResult, QueuePublisher } from '@cardstack/runtime-common';
import {
  makeLintSubmissionFiles,
  type SubmissionFile,
} from '../lib/pr-listing/lint-submission-files.ts';

const OPTS = {
  roomId: '!room:localhost',
  listingId: 'http://localhost:4201/test/Listing/1',
};

function cleanResult(overrides: Partial<LintResult> = {}): LintResult {
  return { output: '', fixed: false, messages: [], passed: true, ...overrides };
}

function makeQueuePublisher(
  resultsByFilename: Record<string, LintResult | Error>,
): { queuePublisher: QueuePublisher; publishedJobs: any[] } {
  let publishedJobs: any[] = [];
  let queuePublisher: QueuePublisher = {
    publish: async (job: any) => {
      publishedJobs.push(job);
      let result = resultsByFilename[job.args.filename];
      if (!result) {
        throw new Error(`unexpected lint job for ${job.args.filename}`);
      }
      return {
        id: publishedJobs.length,
        done:
          result instanceof Error
            ? Promise.reject(result)
            : Promise.resolve(result),
      } as any;
    },
    destroy: async () => {},
  };
  return { queuePublisher, publishedJobs };
}

module('lint-submission-files', () => {
  test('publishes one lint-source job per lintable file', async (assert) => {
    let files: SubmissionFile[] = [
      { filename: 'catalog/MyListing/component.gts', contents: 'let a = 1' },
      { filename: 'catalog/MyListing/util.ts', contents: 'let b = 2' },
      { filename: 'catalog/MyListing/listing.json', contents: '{}' },
      { filename: 'catalog/MyListing/photo.png', contents: 'binary' },
    ];
    let { queuePublisher, publishedJobs } = makeQueuePublisher({
      'catalog/MyListing/component.gts': cleanResult({ output: 'let a = 1' }),
      'catalog/MyListing/util.ts': cleanResult({ output: 'let b = 2' }),
    });

    let outcome = await makeLintSubmissionFiles(queuePublisher)(files, OPTS);

    assert.strictEqual(
      publishedJobs.length,
      2,
      'only .gts and .ts files get lint jobs',
    );
    assert.deepEqual(
      publishedJobs[0],
      {
        jobType: 'lint-source',
        concurrencyGroup: 'lint:submission:0',
        timeout: 30,
        priority: 10,
        args: {
          source: 'let a = 1',
          filename: 'catalog/MyListing/component.gts',
        },
      },
      'publishes the lint-source payload the worker task consumes',
    );
    assert.strictEqual(
      publishedJobs[1].concurrencyGroup,
      'lint:submission:1',
      'jobs spread across concurrency-group buckets by index',
    );
    assert.true(outcome.passed, 'clean results pass');
    assert.strictEqual(outcome.fixedFileCount, 0, 'nothing fixed');
    assert.deepEqual(
      outcome.fixedFiles,
      files,
      'all files (including non-lintable) come back in order',
    );
  });

  test('applies fixed output from the lint job', async (assert) => {
    let files: SubmissionFile[] = [
      { filename: 'a.gts', contents: 'let a=1' },
      { filename: 'b.gts', contents: 'let b = 2;\n' },
      { filename: 'notes.md', contents: '# hi' },
    ];
    let { queuePublisher } = makeQueuePublisher({
      'a.gts': cleanResult({ output: 'let a = 1;\n', fixed: true }),
      'b.gts': cleanResult({ output: 'let b = 2;\n', fixed: false }),
    });

    let outcome = await makeLintSubmissionFiles(queuePublisher)(files, OPTS);

    assert.true(outcome.passed);
    assert.strictEqual(outcome.fixedFileCount, 1, 'only a.gts was fixed');
    assert.deepEqual(outcome.fixedFiles, [
      { filename: 'a.gts', contents: 'let a = 1;\n' },
      { filename: 'b.gts', contents: 'let b = 2;\n' },
      { filename: 'notes.md', contents: '# hi' },
    ]);
  });

  test('collects error-severity messages as formatted lintErrors', async (assert) => {
    let files: SubmissionFile[] = [
      { filename: 'bad.gts', contents: 'nope' },
      { filename: 'warned.gts', contents: 'meh' },
    ];
    let { queuePublisher } = makeQueuePublisher({
      'bad.gts': cleanResult({
        output: 'nope',
        passed: false,
        messages: [
          {
            ruleId: '@cardstack/boxel/no-literal-realm-urls',
            severity: 2,
            message: 'Do not hardcode realm URLs',
            line: 3,
            column: 7,
            source: 'eslint',
          },
        ],
      }),
      'warned.gts': cleanResult({
        output: 'meh',
        messages: [
          {
            ruleId: null,
            severity: 1,
            message: 'just a warning',
            line: 1,
            column: 1,
            source: 'template-lint',
          },
        ],
      }),
    });

    let outcome = await makeLintSubmissionFiles(queuePublisher)(files, OPTS);

    assert.false(outcome.passed, 'severity-2 message fails the lint gate');
    assert.deepEqual(outcome.lintErrors, [
      'bad.gts:3:7 [@cardstack/boxel/no-literal-realm-urls] Do not hardcode realm URLs',
    ]);
  });

  test('rejects with the filename when a lint job fails', async (assert) => {
    let files: SubmissionFile[] = [{ filename: 'crash.gts', contents: 'boom' }];
    let { queuePublisher } = makeQueuePublisher({
      'crash.gts': new Error('job timeout'),
    });

    await assert.rejects(
      makeLintSubmissionFiles(queuePublisher)(files, OPTS),
      /lint-source job failed for crash\.gts: job timeout/,
    );
  });
});
