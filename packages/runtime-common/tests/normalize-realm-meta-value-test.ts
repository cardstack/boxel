import type { SharedTests } from '../helpers/index.ts';
import {
  normalizeRealmMetaValue,
  type CardTypeSummary,
} from '../index-structure.ts';

const personSummary: CardTypeSummary = {
  code_ref: 'http://example.test/realm/person/Person',
  display_name: 'Person',
  total: 3,
  icon_html: '<svg />',
};

const markdownSummary: CardTypeSummary = {
  code_ref: '@cardstack/base/markdown-file-def/MarkdownDef',
  display_name: 'Markdown',
  total: 5,
  icon_html: '<svg />',
};

const tests = Object.freeze({
  'undefined value normalizes to empty groups': async (assert) => {
    let normalized = normalizeRealmMetaValue(undefined);
    assert.deepEqual(normalized, { instances: [], files: [] });
  },

  'null value normalizes to empty groups': async (assert) => {
    let normalized = normalizeRealmMetaValue(null);
    assert.deepEqual(normalized, { instances: [], files: [] });
  },

  'legacy array shape maps to instances, files defaults to empty': async (
    assert,
  ) => {
    // Realms indexed before realm_meta.value was partitioned stored a bare
    // CardTypeSummary[] (instances only). Readers must accept that shape until
    // every realm has been reindexed.
    let normalized = normalizeRealmMetaValue([personSummary]);
    assert.deepEqual(normalized, {
      instances: [personSummary],
      files: [],
    });
  },

  'partitioned shape passes through': async (assert) => {
    let value = { instances: [personSummary], files: [markdownSummary] };
    let normalized = normalizeRealmMetaValue(value);
    assert.deepEqual(normalized, value);
  },

  'missing arms default to empty arrays': async (assert) => {
    // A partial object (e.g. data inserted by a test that only wrote one arm)
    // shouldn't propagate undefined into consumers — both arms always exist on
    // the normalized result.
    let normalized = normalizeRealmMetaValue({ instances: [personSummary] });
    assert.deepEqual(normalized, {
      instances: [personSummary],
      files: [],
    });
  },

  'unrecognized object shape normalizes to empty groups': async (assert) => {
    // Defensive: if some other writer parked an unrelated JSONB blob in
    // realm_meta.value (older delete-realm test fixture used this), neither
    // arm contains those rows but readers don't crash.
    let normalized = normalizeRealmMetaValue({
      somethingElse: { foo: 'bar' },
    });
    assert.deepEqual(normalized, { instances: [], files: [] });
  },
} as SharedTests<{}>);

export default tests;
