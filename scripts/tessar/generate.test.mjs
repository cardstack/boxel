import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, expectedSummary, validateSummary } from './generate.mjs';

test('Tessar datasets have fixed sizes, deterministic fabricated records and valid links', () => {
  for (let [preset, count] of [
    ['1x', 1255],
    ['10x', 12550],
  ]) {
    let { records } = generate({ preset });
    assert.equal(records.size, count);
    assert.deepEqual(records, generate({ preset }).records);
    for (let { data } of records.values()) {
      assert.match(data.attributes.label, /^Tessar /);
      for (let relationship of Object.values(data.relationships ?? {})) {
        assert.ok(records.has(relationship.links.self.slice(3)));
      }
    }
  }
  assert.throws(() => generate({ preset: '100x' }), /Preset/);
});

test('Tessar raw-data oracle reflects membership, content, transitive edits and deletions', () => {
  let { records } = generate();
  let id = 'DaySummary/00000';
  let before = expectedSummary(records, id);
  assert.equal(before.studentCount, 2);
  assert.equal(before.slotCount, 1);
  assert.equal(before.observationCount, 1);
  assert.equal(before.readyReportCount, 1);
  assert.deepEqual(
    before.rows.map((r) => r.sourceId),
    ['Slot/00000'],
  );
  records.get('Student/00000').data.attributes.label = 'Tessar revised student';
  assert.equal(
    expectedSummary(records, id).rows[0].studentLabel,
    'Tessar revised student',
  );
  records.get('Observation/00000').data.attributes.score = 123;
  assert.equal(expectedSummary(records, id).scoreTotal, 123);
  records.get('Slot/00002').data.attributes.day = '2026-01-12';
  assert.equal(expectedSummary(records, id).slotCount, 2);
  records.delete('Slot/00000');
  assert.deepEqual(
    expectedSummary(records, id).rows.map((r) => r.sourceId),
    ['Slot/00002'],
  );
  assert.throws(
    () => validateSummary(before, expectedSummary(records, id)),
    /mismatch/,
  );
});
