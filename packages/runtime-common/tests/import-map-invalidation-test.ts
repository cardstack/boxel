import type { SharedTests } from '../helpers/index.ts';
import { invalidationsNameImportMap } from '../import-map-file.ts';

const REALM = 'https://realm.example.com/experiments/';

// Whether an index pass touched the realm's own import map.
//
// This predicate decides whether the indexer throws away its resolution state,
// so a false negative is not a missed refresh — it is a realm that keeps
// indexing against a map it no longer has, until someone restarts the
// prerenderer. Both spellings matter: the index drops `.json` from an id the
// same way it does for a card instance, and the full filename is the file's
// actual URL.

const tests = Object.freeze({
  'the id the index actually emits is recognised': async (assert) => {
    assert.true(
      invalidationsNameImportMap([`${REALM}importmap`], REALM),
      'extension dropped — what an incremental pass emits',
    );
    assert.true(
      invalidationsNameImportMap([`${REALM}importmap.json`], REALM),
      'and the full filename, which is the file’s own URL',
    );
  },

  'a package manifest is not the realm map': async (assert) => {
    // `crm/importmap.json` is a PACKAGE's manifest. It changes what `crm` is,
    // not what the realm resolves, and treating it as the realm's map would
    // flush the whole realm's resolution state on every package edit.
    assert.false(
      invalidationsNameImportMap([`${REALM}crm/importmap`], REALM),
      'a manifest one directory down is a different file',
    );
  },

  'another realm’s map is not this realm’s': async (assert) => {
    assert.false(
      invalidationsNameImportMap(
        ['https://realm.example.com/other/importmap'],
        REALM,
      ),
    );
  },

  'it finds the map among unrelated invalidations': async (assert) => {
    // The realistic shape: one map edit arrives with the fan-out of every
    // card that depended on what it resolved.
    assert.true(
      invalidationsNameImportMap(
        [
          `${REALM}sprint-task.gts`,
          `${REALM}TeamMember/03e293b9`,
          `${REALM}importmap`,
          `${REALM}Spec/team`,
        ],
        REALM,
      ),
    );
    assert.false(
      invalidationsNameImportMap(
        [`${REALM}sprint-task.gts`, `${REALM}TeamMember/03e293b9`],
        REALM,
      ),
      'and says no when it is genuinely absent',
    );
  },
} as SharedTests<{}>);

export default tests;
