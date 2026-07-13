import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  renderIndexingDashboard,
  type DashboardSnapshot,
  type PendingJob,
} from '../handlers/handle-indexing-dashboard.ts';
import type { RealmIndexingState } from '../indexing-event-sink.ts';

const realmA = 'http://example.com/realm-a/';
const realmB = 'http://example.com/realm-b/';

function jobState(
  overrides: Partial<RealmIndexingState> = {},
): RealmIndexingState {
  return {
    realmURL: realmA,
    jobId: 1,
    jobType: 'incremental',
    status: 'indexing',
    totalFiles: 10,
    filesCompleted: 4,
    files: [],
    completedFiles: [],
    startedAt: Date.now() - 5_000,
    lastUpdatedAt: Date.now(),
    ...overrides,
  };
}

function snapshot(overrides: Partial<DashboardSnapshot> = {}): string {
  return renderIndexingDashboard({
    active: [],
    pending: [],
    history: [],
    ...overrides,
  });
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

module(basename(import.meta.filename), function () {
  module('indexing dashboard rendering', function () {
    test('a prerender job renders its own label and real totals, never the calculating state', function (assert) {
      let html = snapshot({
        active: [
          jobState({
            jobId: 7,
            jobType: 'prerender_html',
            totalFiles: 93,
            filesCompleted: 40,
          }),
        ],
      });
      assert.true(
        html.includes('prerender HTML'),
        'the job is labeled as a prerender job, not "<jobType> index"',
      );
      assert.false(
        html.includes('prerender_html index'),
        'the raw queue job type is not conflated with the index label',
      );
      assert.true(
        html.includes('40 / 93 files (43%)'),
        'the progress fraction renders from the real totals',
      );
      assert.true(
        html.includes('class="progress-bar prerender"'),
        'the prerender progress bar carries its distinguishing class',
      );
    });

    test('a zero-total prerender job renders its counts rather than the calculating state', function (assert) {
      let html = snapshot({
        active: [
          jobState({
            jobType: 'prerender_html',
            totalFiles: 0,
            filesCompleted: 0,
          }),
        ],
      });
      assert.false(
        html.includes('Calculating files to index'),
        'a prerender job announces its real total up front, so there is no calculating window',
      );
      assert.true(html.includes('0 / 0 files (0%)'));
    });

    test('an index job announcing a zero total shows the calculating state', function (assert) {
      let html = snapshot({
        active: [jobState({ totalFiles: 0, filesCompleted: 0 })],
      });
      assert.true(html.includes('incremental index'), 'index label unchanged');
      assert.true(html.includes('Calculating files to index'));
      assert.true(html.includes('class="progress-bar calculating"'));
    });

    test('concurrent index and prerender jobs for one realm group into a single card, index pass first', function (assert) {
      let html = snapshot({
        active: [
          jobState({
            jobId: 8,
            jobType: 'prerender_html',
            totalFiles: 93,
            filesCompleted: 40,
          }),
          jobState({ jobId: 7, totalFiles: 93, filesCompleted: 90 }),
        ],
      });
      assert.strictEqual(
        count(html, 'class="realm-card indexing"'),
        1,
        'one card for the realm, not one per job',
      );
      assert.strictEqual(count(html, 'class="job-section"'), 2);
      assert.true(
        html.indexOf('incremental index') < html.indexOf('prerender HTML'),
        'the index section renders before the prerender section regardless of event order',
      );
    });

    test('a finished index pass shows as a ✓ line while the prerender pass runs', function (assert) {
      let html = snapshot({
        active: [
          jobState({
            jobId: 8,
            jobType: 'prerender_html',
            totalFiles: 93,
            filesCompleted: 40,
          }),
        ],
        history: [
          jobState({
            jobId: 7,
            status: 'finished',
            totalFiles: 93,
            filesCompleted: 93,
          }),
          // Another realm's finished job must not leak into realm A's card.
          jobState({
            jobId: 5,
            jobType: 'from-scratch',
            status: 'finished',
            realmURL: realmB,
          }),
        ],
      });
      assert.strictEqual(count(html, 'class="job-done"'), 1);
      assert.true(
        html.includes('incremental index'),
        'the ✓ line names the finished index pass',
      );
      assert.false(
        html.includes('from-scratch index'),
        'the other realm’s finished job stays out of this card',
      );
      assert.true(html.includes('job #7 &middot; 93 files &middot; finished'));
      assert.true(
        html.indexOf('class="job-done"') < html.indexOf('class="job-section"'),
        'the finished index line renders above the running prerender section',
      );
    });

    test('a running index pass never shows a finished-prerender ✓ line', function (assert) {
      let html = snapshot({
        active: [jobState()],
        history: [
          // Same realm — but this prerender belongs to the previous run,
          // and a ✓ next to a running index would read as if this run's
          // HTML were already done.
          jobState({
            jobId: 2,
            jobType: 'prerender_html',
            status: 'finished',
          }),
        ],
      });
      assert.strictEqual(count(html, 'class="job-section"'), 1);
      assert.strictEqual(
        count(html, 'class="job-done"'),
        0,
        'the ✓ fallback is one-directional: finished index under a running prerender only',
      );
    });

    test('active jobs in different realms render separate cards', function (assert) {
      let html = snapshot({
        active: [
          jobState(),
          jobState({
            jobId: 2,
            jobType: 'prerender_html',
            realmURL: realmB,
          }),
        ],
      });
      assert.strictEqual(count(html, 'class="realm-card indexing"'), 2);
    });

    test('pending and completed prerender jobs render in their tables under the queue job type', function (assert) {
      let pending: PendingJob[] = [
        {
          jobId: 12,
          jobType: 'prerender_html',
          realmURL: realmA,
          createdAt: Date.now() - 1_000,
          priority: 0,
        },
      ];
      let html = snapshot({
        pending,
        history: [
          jobState({
            jobId: 9,
            jobType: 'prerender_html',
            status: 'finished',
          }),
        ],
      });
      assert.strictEqual(
        count(html, '<td>prerender_html</td>'),
        2,
        'one row in Pending Jobs, one in Recent Completed',
      );
    });
  });
});
