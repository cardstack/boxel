import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../helpers/setup';

// When a field's card class evaluates to undefined — most often a default
// import of a module that only has named exports, or a genuine cycle — the
// thrown error names the field and its owning card, so the author lands on
// the exact declaration instead of bisecting the schema. These call the
// `field` decorator the same way Babel's decorator transform does.
module('Unit | card field thunk errors', function (hooks) {
  setupRenderingTest(hooks);

  test('an undefined field card class names the field and its owner', async function (assert) {
    let loader = getService('loader-service').loader;
    let api = (await loader.import('@cardstack/base/card-api')) as any;
    class Broken extends api.CardDef {}

    let cases: [string, string, (value: any) => unknown][] = [
      ['linksTo', 'src', api.linksTo],
      ['linksToMany', 'links', api.linksToMany],
      ['contains', 'meta', api.contains],
      ['containsMany', 'items', api.containsMany],
    ];
    for (let [label, fieldName, fieldFn] of cases) {
      assert.throws(
        () =>
          api.field(Broken.prototype, fieldName, {
            initializer: () => fieldFn(undefined),
          }),
        new RegExp(`field '${fieldName}' on 'Broken'`),
        `${label} names the field and owner`,
      );
    }
  });
});
