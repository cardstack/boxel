import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { SKILL_FEATURES } from '@cardstack/runtime-common/ai/debug';

const EVALUATIONS_DIR = new URL('./eval-realm/Evaluation/', import.meta.url);

// The runner enables each of an evaluation's skill features before the first
// prompt, and a name the ai-bot doesn't register stops the run at that step.
test('every evaluation lists only skill features the ai-bot registers', () => {
  let files = readdirSync(EVALUATIONS_DIR).filter((name) =>
    name.endsWith('.json'),
  );
  assert.ok(files.length > 0, 'no evaluations found');
  let registered = Object.keys(SKILL_FEATURES);
  let unknown = files.flatMap((name) => {
    let card = JSON.parse(readFileSync(new URL(name, EVALUATIONS_DIR), 'utf8'));
    let features: unknown = card.data?.attributes?.skillFeatures ?? [];
    assert.ok(Array.isArray(features), `${name}: skillFeatures is not a list`);
    return features
      .filter((feature) => !registered.includes(feature))
      .map((feature) => `${name}: ${feature}`);
  });
  assert.deepEqual(unknown, [], 'unregistered skill features');
});
