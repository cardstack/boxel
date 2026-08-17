import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { FILEDEF_CODE_REF_BY_EXTENSION } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

// Every FileDef subtype module exports its def class both named and as the
// default, so `import X from '…'` and `import { X } from '…'` are equally
// valid. A named-only module makes a default import silently evaluate to
// undefined, which then fails far away at schema time; a consistent shape
// removes the trap. Walking the extension registry keeps this guard covering
// every registered subtype, including ones added later.
module('Unit | FileDef subtype export shapes', function (hooks) {
  setupRenderingTest(hooks);

  test('every registered subtype module has matching named and default exports', async function (assert) {
    let loader = getService('loader-service').loader;
    let seen = new Set<string>();
    for (let [extension, ref] of Object.entries(
      FILEDEF_CODE_REF_BY_EXTENSION,
    )) {
      // `.mismatch` is a synthetic registry entry for a non-existent module,
      // not a real subtype.
      if (extension === '.mismatch') {
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
      // Multi-leaf modules (e.g. gltf-model-def's GltfDef/GlbDef) default to
      // one of their leaves; existence is all that's required there.
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
});
