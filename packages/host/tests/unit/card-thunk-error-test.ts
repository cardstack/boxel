import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../helpers/setup';

// When a field's card class evaluates to undefined — most often a default
// import of a module that only has named exports, or a genuine cycle — the
// thrown error names the field and its owning card and spells out both
// causes, so the author lands on the exact declaration instead of bisecting
// the schema. The eager form throws at decoration time; the thunk form
// throws at the first `field.card` read. These call the `field` decorator
// the same way Babel's decorator transform does.
module('Unit | card field thunk errors', function (hooks) {
  setupRenderingTest(hooks);

  let fieldKinds = (api: any): [string, string, (value: any) => unknown][] => [
    ['linksTo', 'src', api.linksTo],
    ['linksToMany', 'links', api.linksToMany],
    ['contains', 'meta', api.contains],
    ['containsMany', 'items', api.containsMany],
  ];

  test('an undefined field card class names the field, the owner, and both causes', async function (assert) {
    let loader = getService('loader-service').loader;
    let api = (await loader.import('@cardstack/base/card-api')) as any;
    class Broken extends api.CardDef {}

    for (let [label, fieldName, fieldFn] of fieldKinds(api)) {
      assert.throws(
        () =>
          api.field(Broken.prototype, fieldName, {
            initializer: () => fieldFn(undefined),
          }),
        (err: Error) =>
          new RegExp(`field '${fieldName}' on 'Broken'`).test(err.message) &&
          /export shape/.test(err.message) &&
          /cyclic dependency/.test(err.message),
        `${label} names the field, the owner, and both causes`,
      );
    }
  });

  test('a thunk resolving to undefined names the field at first read', async function (assert) {
    let loader = getService('loader-service').loader;
    let api = (await loader.import('@cardstack/base/card-api')) as any;
    let { isField } = (await loader.import('@cardstack/runtime-common')) as any;
    class BrokenThunk extends api.CardDef {}

    for (let [label, fieldName, fieldFn] of fieldKinds(api)) {
      // The thunk defers evaluation, so decoration itself succeeds. The
      // decorator returns the property descriptor whose getter carries the
      // Field object; `field.card` is the accessor every consumer reads
      // through.
      let descriptor = api.field(BrokenThunk.prototype, fieldName, {
        initializer: () => fieldFn(() => undefined),
      });
      let field = (descriptor?.get as any)?.[isField];
      assert.ok(field, `${label} field is registered`);
      // …and the named error surfaces the first time the class is needed.
      assert.throws(
        () => field.card,
        (err: Error) =>
          new RegExp(`field '${fieldName}' on 'BrokenThunk'`).test(
            err.message,
          ) &&
          /export shape/.test(err.message) &&
          /cyclic dependency/.test(err.message),
        `${label} thunk form names the field and owner at first read`,
      );
    }
  });
});
