import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  TurnToolTelemetry,
  describeToolArg,
} from '../src/factory-agent/agent-tool-telemetry.ts';

module('agent-tool-telemetry', function (hooks) {
  let workspaceDir: string;

  hooks.beforeEach(function () {
    workspaceDir = mkdtempSync(join(tmpdir(), 'tool-telemetry-'));
  });

  hooks.afterEach(function () {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('a clean turn flags nothing', function (assert) {
    let t = new TurnToolTelemetry(workspaceDir);
    t.record('Read', { file_path: 'a.gts' });
    t.record('Edit', { file_path: 'a.gts' });
    t.record('Bash', { command: 'boxel search --realm x' });
    let s = t.finish();
    assert.strictEqual(s.totalCalls, 3);
    assert.deepEqual(s.concerns, [], 'no waste concerns');
  });

  test('flags a duplicate Read of the same file', function (assert) {
    let t = new TurnToolTelemetry(workspaceDir);
    t.record('Read', { file_path: 'card.gts' });
    t.record('Read', { file_path: 'card.gts' });
    t.record('Read', { file_path: 'other.gts' });
    let s = t.finish();
    assert.ok(
      s.concerns.some((c) => c.includes('re-read') && c.includes('card.gts')),
      'duplicate read is flagged',
    );
  });

  test('flags a whole-file Write over an existing file', function (assert) {
    writeFileSync(join(workspaceDir, 'model.gts'), 'export class M {}');
    let t = new TurnToolTelemetry(workspaceDir);
    t.record('Write', { file_path: 'model.gts' }); // exists → rewrite
    t.record('Write', { file_path: 'new.gts' }); // absent → fine
    let s = t.finish();
    assert.ok(
      s.concerns.some(
        (c) => c.includes('whole-file Write') && c.includes('model.gts'),
      ),
      'rewrite of existing file flagged',
    );
    assert.notOk(
      s.concerns.some((c) => c.includes('new.gts')),
      'first-time write of a new file is not flagged',
    );
  });

  test('flags mutating Bash but not read-only Bash', function (assert) {
    let t = new TurnToolTelemetry(workspaceDir);
    t.record('Bash', { command: 'ls -la && grep foo bar' });
    t.record('Bash', { command: 'rm -rf design/old' });
    let s = t.finish();
    assert.ok(
      s.concerns.some((c) => c.includes('mutating Bash')),
      'mutating bash flagged',
    );
  });

  test('flags screenshot thrash only past the threshold', function (assert) {
    let t = new TurnToolTelemetry(workspaceDir);
    for (let i = 0; i < 5; i++) {
      t.record('mcp__factory__screenshot_html', { path: `design/v${i}.html` });
    }
    let s = t.finish();
    assert.ok(
      s.concerns.some((c) => c.includes('screenshots')),
      '5 screenshots flagged',
    );
  });

  test('describeToolArg returns a basename for path-bearing tools', function (assert) {
    assert.strictEqual(
      describeToolArg('Read', { file_path: 'design/foo/bar.gts' }),
      'bar.gts',
    );
    assert.strictEqual(
      describeToolArg('Bash', { command: 'boxel search --realm https://x/y' }),
      'boxel search --realm https://x/y',
    );
    assert.strictEqual(
      describeToolArg('mcp__factory__screenshot_html', {
        path: 'design/card.html',
      }),
      'card.html',
    );
  });
});
