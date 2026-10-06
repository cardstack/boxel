import {
  DEFAULT_FALLBACK_MODEL_ID,
  DEFAULT_FALLBACK_MODELS,
  RETIRED_FALLBACK_MODELS,
  findFallbackModel,
  type FallbackModelConfig,
} from '../matrix-constants.ts';
import type { SharedTests } from '../helpers/index.ts';

const tests: SharedTests<unknown> = Object.freeze({
  'ships at least one curated model': async (assert) => {
    assert.ok(
      DEFAULT_FALLBACK_MODELS.length >= 1,
      `expected at least one curated model, got ${DEFAULT_FALLBACK_MODELS.length}`,
    );
  },

  'has no duplicate modelId': async (assert) => {
    let ids = [...DEFAULT_FALLBACK_MODELS, ...RETIRED_FALLBACK_MODELS].map(
      (m) => m.modelId,
    );
    let unique = new Set(ids);
    assert.strictEqual(
      unique.size,
      ids.length,
      `expected unique modelIds, got duplicates in ${JSON.stringify(ids)}`,
    );
  },

  'DEFAULT_FALLBACK_MODEL_ID matches a curated row': async (assert) => {
    let match = DEFAULT_FALLBACK_MODELS.find(
      (m) => m.modelId === DEFAULT_FALLBACK_MODEL_ID,
    );
    assert.ok(
      match,
      `DEFAULT_FALLBACK_MODEL_ID '${DEFAULT_FALLBACK_MODEL_ID}' is not in DEFAULT_FALLBACK_MODELS`,
    );
  },

  'findFallbackModel resolves curated and retired rows': async (assert) => {
    for (let row of [...DEFAULT_FALLBACK_MODELS, ...RETIRED_FALLBACK_MODELS]) {
      assert.strictEqual(
        findFallbackModel(row.modelId),
        row,
        `${row.modelId}: findFallbackModel did not return its row`,
      );
    }
    assert.strictEqual(
      findFallbackModel('not/a-model'),
      undefined,
      'unknown model id resolves to undefined',
    );
  },

  'every row has valid typed fields': async (assert) => {
    for (let row of [...DEFAULT_FALLBACK_MODELS, ...RETIRED_FALLBACK_MODELS]) {
      let label = row.modelId || '<no modelId>';
      assert.strictEqual(
        typeof row.modelId,
        'string',
        `${label}: modelId is not a string`,
      );
      assert.ok(row.modelId.length > 0, `${label}: modelId is empty`);
      assert.strictEqual(
        typeof row.displayName,
        'string',
        `${label}: displayName is not a string`,
      );
      assert.ok(row.displayName.length > 0, `${label}: displayName is empty`);
      assert.strictEqual(
        typeof row.toolsSupported,
        'boolean',
        `${label}: toolsSupported is not a boolean`,
      );
      assert.ok(
        Array.isArray(row.inputModalities),
        `${label}: inputModalities is not an array`,
      );
      assert.ok(
        row.inputModalities.length > 0,
        `${label}: inputModalities is empty`,
      );
      for (let m of row.inputModalities) {
        assert.strictEqual(
          typeof m,
          'string',
          `${label}: inputModalities contains a non-string ${m}`,
        );
      }
    }
  },

  'every row is shaped like FallbackModelConfig': async (assert) => {
    let allowed = new Set([
      'modelId',
      'displayName',
      'toolsSupported',
      'inputModalities',
    ]);
    for (let row of [...DEFAULT_FALLBACK_MODELS, ...RETIRED_FALLBACK_MODELS]) {
      let extras = Object.keys(row).filter((k) => !allowed.has(k));
      assert.deepEqual(
        extras,
        [],
        `${row.modelId}: unexpected extra fields ${JSON.stringify(extras)}`,
      );
    }
  },
});

const _typecheck: FallbackModelConfig = DEFAULT_FALLBACK_MODELS[0];
void _typecheck;

export default tests;
