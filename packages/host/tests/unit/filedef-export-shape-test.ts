import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  FILEDEF_CODE_REF_BY_EXTENSION,
  baseRealm,
} from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

// Every FileDef module exports its def class both named and as the default,
// so `import X from '…'` and `import { X } from '…'` are equally valid. A
// named-only module makes a default import silently evaluate to undefined,
// which then fails far away at schema time; a consistent shape removes the
// trap. Walking the extension registry keeps this guard covering every
// registered subtype, including ones added later.
//
// What this pins is "a default import never yields undefined" — not "a
// default import yields the class you named". A module carrying a second,
// named-only class is the sharper trap: `import RasterImageDef from
// './image-file-def'` evaluates to ImageDef (the default), a perfectly valid
// class, so nothing throws and the field is silently wired to the wrong
// class. image-file-def (RasterImageDef) and zip-file-def (ArchiveEntryField)
// are the two such modules today; only their registered class is pinned to
// the default below.
module('Unit | FileDef subtype export shapes', function (hooks) {
  setupRenderingTest(hooks);

  test('every registered subtype module has matching named and default exports', async function (assert) {
    let loader = getService('loader-service').loader;
    let seen = new Set<string>();
    for (let ref of Object.values(FILEDEF_CODE_REF_BY_EXTENSION)) {
      // Real entries are built by `baseModule()` in full-URL form; a bare
      // relative specifier marks a synthetic test-only entry with no module
      // behind it (`.mismatch` today).
      if (!ref.module.includes('://')) {
        continue;
      }
      let key = `${ref.module}#${ref.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      let ns = (await loader.import(ref.module)) as Record<string, unknown>;
      assert.ok(ns[ref.name], `${ref.module} has named export ${ref.name}`);
      assert.ok(ns['default'], `${ref.module} has a default export`);
      // A module registered under exactly one class defaults to that class.
      // A module that ever registers two leaf classes would default to one
      // of them; there, existence of *a* default is all this walk can
      // require (see the module comment for why that case is a trap of its
      // own).
      let namesInModule = new Set(
        Object.values(FILEDEF_CODE_REF_BY_EXTENSION)
          .filter((r) => r.module === ref.module)
          .map((r) => r.name),
      );
      if (namesInModule.size === 1) {
        assert.strictEqual(
          ns['default'],
          ns[ref.name],
          `${ref.module} default export is ${ref.name}`,
        );
      }
    }
  });

  // The registry maps extensions to leaf subtypes only, so the family's base
  // modules — the ones a subtype author actually imports from — appear in no
  // entry and the walk above never touches them. One of these defaults is
  // already load-bearing in the shipped tree: svg-image-def default-imports
  // image-file-def.
  test('family base modules have matching named and default exports', async function (assert) {
    let loader = getService('loader-service').loader;
    let baseModules: { module: string; name: string }[] = [
      { module: 'image-file-def', name: 'ImageDef' },
      { module: 'audio-file-def', name: 'AudioDef' },
      { module: 'video-file-def', name: 'VideoDef' },
      { module: 'font-file-def', name: 'FontDef' },
      { module: 'three-d-model-def', name: 'ThreeDModelDef' },
      { module: 'file-api', name: 'FileDef' },
    ];
    for (let { module: moduleName, name } of baseModules) {
      let moduleId = `${baseRealm.url}${moduleName}`;
      let ns = (await loader.import(moduleId)) as Record<string, unknown>;
      assert.ok(ns[name], `${moduleId} has named export ${name}`);
      assert.ok(ns['default'], `${moduleId} has a default export`);
      assert.strictEqual(
        ns['default'],
        ns[name],
        `${moduleId} default export is ${name}`,
      );
    }
  });
});
