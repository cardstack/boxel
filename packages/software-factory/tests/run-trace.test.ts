import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  initRunTrace,
  resetRunTraceForTesting,
  startSpan,
  traceEvent,
  withSpan,
} from '../src/run-trace.ts';

function readTraceLines(workspaceDir: string): Record<string, unknown>[] {
  let traceDir = join(workspaceDir, '.factory-trace');
  let files = readdirSync(traceDir).filter((f) => f.endsWith('.ndjson'));
  if (files.length !== 1) {
    throw new Error(`expected exactly one trace file, found ${files.length}`);
  }
  return readFileSync(join(traceDir, files[0]), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

module('run-trace', function (hooks) {
  let workspaceDir: string;

  hooks.beforeEach(function () {
    resetRunTraceForTesting();
    workspaceDir = mkdtempSync(join(tmpdir(), 'run-trace-test-'));
  });

  hooks.afterEach(function () {
    resetRunTraceForTesting();
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('header line carries schema version and run tags', function (assert) {
    initRunTrace({ workspaceDir, tags: { targetRealm: 'https://r/' } });
    let [header] = readTraceLines(workspaceDir);
    assert.strictEqual(header.v, 1);
    assert.strictEqual(header.c, 'run');
    assert.strictEqual(header.n, 'meta');
    assert.strictEqual(header.targetRealm, 'https://r/');
    assert.strictEqual(typeof header.t, 'number');
  });

  test('spans buffered before init flush after the header', function (assert) {
    let end = startSpan('startup', 'load-brief');
    end();
    traceEvent('scheduler', 'pre-init-event');
    initRunTrace({ workspaceDir });
    let lines = readTraceLines(workspaceDir);
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].n, 'meta');
    assert.strictEqual(lines[1].n, 'load-brief');
    assert.strictEqual(lines[2].n, 'pre-init-event');
  });

  test('span lines have start, duration, category, name, and tags', function (assert) {
    initRunTrace({ workspaceDir });
    let end = startSpan('inference', 'design', { issue: 'sn-1', iteration: 1 });
    end({ status: 'done', toolCalls: 7 });
    let lines = readTraceLines(workspaceDir);
    let span = lines[1];
    assert.strictEqual(span.c, 'inference');
    assert.strictEqual(span.n, 'design');
    assert.strictEqual(span.issue, 'sn-1');
    assert.strictEqual(span.iteration, 1);
    assert.strictEqual(span.status, 'done');
    assert.strictEqual(span.toolCalls, 7);
    assert.strictEqual(typeof span.t, 'number');
    assert.strictEqual(typeof span.d, 'number');
  });

  test('instant events have no duration; undefined tags are dropped', function (assert) {
    initRunTrace({ workspaceDir });
    traceEvent('scheduler', 'skip-stale-done', {
      issue: 'sn-1',
      cycle: undefined,
    });
    let lines = readTraceLines(workspaceDir);
    let event = lines[1];
    assert.false('d' in event);
    assert.false('cycle' in event);
    assert.strictEqual(event.issue, 'sn-1');
  });

  test('closing a span twice writes exactly one line', function (assert) {
    initRunTrace({ workspaceDir });
    let end = startSpan('sync', 'workspace');
    end({ ok: true });
    end({ ok: false });
    let lines = readTraceLines(workspaceDir);
    assert.strictEqual(lines.length, 2);
    assert.true(lines[1].ok);
  });

  test('withSpan closes on throw and tags the error', async function (assert) {
    initRunTrace({ workspaceDir });
    await assert.rejects(
      withSpan('validation', 'pipeline', undefined, async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    let lines = readTraceLines(workspaceDir);
    assert.strictEqual(lines[1].n, 'pipeline');
    assert.true(lines[1].error);
  });
});
