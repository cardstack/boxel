import { module, test } from 'qunit';
import { basename } from 'path';
import { IndexingEventSink } from '../indexing-event-sink';

module(basename(__filename), function () {
  test('tracks active indexing from start through file visits to finish', function (assert) {
    let sink = new IndexingEventSink();

    assert.deepEqual(sink.getSnapshot(), { active: [], history: [] });

    sink.handleEvent({
      type: 'indexing-started',
      realmURL: 'http://example.com/realm/',
      jobId: 1,
      jobType: 'from-scratch',
      totalFiles: 3,
      files: [
        'http://example.com/realm/a.gts',
        'http://example.com/realm/b.json',
        'http://example.com/realm/c.gts',
      ],
    });

    let { active, history } = sink.getSnapshot();
    assert.strictEqual(active.length, 1);
    assert.strictEqual(history.length, 0);
    assert.strictEqual(active[0].realmURL, 'http://example.com/realm/');
    assert.strictEqual(active[0].totalFiles, 3);
    assert.strictEqual(active[0].filesCompleted, 0);
    assert.strictEqual(active[0].status, 'indexing');

    sink.handleEvent({
      type: 'file-visited',
      realmURL: 'http://example.com/realm/',
      jobId: 1,
      url: 'http://example.com/realm/a.gts',
      filesCompleted: 1,
      totalFiles: 3,
    });

    ({ active } = sink.getSnapshot());
    assert.strictEqual(active[0].filesCompleted, 1);
    assert.deepEqual(active[0].completedFiles, [
      'http://example.com/realm/a.gts',
    ]);

    sink.handleEvent({
      type: 'file-visited',
      realmURL: 'http://example.com/realm/',
      jobId: 1,
      url: 'http://example.com/realm/b.json',
      filesCompleted: 2,
      totalFiles: 3,
    });

    sink.handleEvent({
      type: 'file-visited',
      realmURL: 'http://example.com/realm/',
      jobId: 1,
      url: 'http://example.com/realm/c.gts',
      filesCompleted: 3,
      totalFiles: 3,
    });

    ({ active } = sink.getSnapshot());
    assert.strictEqual(active[0].filesCompleted, 3);

    sink.handleEvent({
      type: 'indexing-finished',
      realmURL: 'http://example.com/realm/',
      jobId: 1,
      stats: {
        instancesIndexed: 1,
        filesIndexed: 2,
        instanceErrors: 0,
        fileErrors: 0,
        totalIndexEntries: 3,
      },
    });

    ({ active, history } = sink.getSnapshot());
    assert.strictEqual(active.length, 0, 'no longer active after finish');
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].realmURL, 'http://example.com/realm/');
    assert.strictEqual(history[0].status, 'finished');
    assert.deepEqual(history[0].stats, {
      instancesIndexed: 1,
      filesIndexed: 2,
      instanceErrors: 0,
      fileErrors: 0,
      totalIndexEntries: 3,
    });
  });

  test('tracks multiple realms concurrently', function (assert) {
    let sink = new IndexingEventSink();

    sink.handleEvent({
      type: 'indexing-started',
      realmURL: 'http://example.com/realm-a/',
      jobId: 1,
      jobType: 'from-scratch',
      totalFiles: 10,
      files: [],
    });

    sink.handleEvent({
      type: 'indexing-started',
      realmURL: 'http://example.com/realm-b/',
      jobId: 2,
      jobType: 'incremental',
      totalFiles: 2,
      files: [],
    });

    assert.strictEqual(sink.getActiveIndexing().length, 2);

    sink.handleEvent({
      type: 'indexing-finished',
      realmURL: 'http://example.com/realm-b/',
      jobId: 2,
    });

    assert.strictEqual(sink.getActiveIndexing().length, 1);
    assert.strictEqual(
      sink.getActiveIndexing()[0].realmURL,
      'http://example.com/realm-a/',
    );
    assert.strictEqual(sink.getHistory().length, 1);
  });

  test('ignores file-visited for unknown realm', function (assert) {
    let sink = new IndexingEventSink();

    sink.handleEvent({
      type: 'file-visited',
      realmURL: 'http://example.com/unknown/',
      jobId: 99,
      url: 'http://example.com/unknown/x.json',
      filesCompleted: 1,
      totalFiles: 1,
    });

    assert.strictEqual(sink.getActiveIndexing().length, 0);
  });
});
