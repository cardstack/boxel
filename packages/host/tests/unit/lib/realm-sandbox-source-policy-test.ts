import { module, test } from 'qunit';

import { classifyCardSourceForSandbox } from '@cardstack/host/lib/realm-sandbox-source-policy';

module('Unit | realm sandbox source policy', function () {
  test('ordinary authored GTS stays in SES', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      import { CardDef, Component } from '@cardstack/base/card-api';
      export class Example extends CardDef {
        static isolated = class extends Component<typeof this> {
          <template><p>The document is visible here.</p></template>
        };
      }
    `);

    assert.strictEqual(result.tier, 'compartment');
    assert.strictEqual(result.reason, 'default-user-card');
  });

  test('DOM globals select the isolated iframe', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      const canvas = document.createElement('canvas');
      export default canvas;
    `);

    assert.strictEqual(result.tier, 'iframe');
    assert.deepEqual(result.signals, ['document']);
  });

  test('Three.js imports select the isolated iframe', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      import * as THREE from 'https://esm.sh/three@0.160.0';
      export default THREE;
    `);

    assert.strictEqual(result.tier, 'iframe');
    assert.deepEqual(result.signals, ['three']);
  });

  test('custom modifiers select the isolated iframe because they receive DOM elements', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      import { modifier } from 'ember-modifier';
      export const measure = modifier((element) => element.clientWidth);
    `);

    assert.strictEqual(result.tier, 'iframe');
    assert.deepEqual(result.signals, ['ember-modifier']);
  });

  test('the trusted safe modifier remains in SES', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      import { safeModifier } from '@cardstack/boxel-ui/modifiers';
      export const templateSource = '<div {{safeModifier "observe-size"}}></div>';
    `);

    assert.strictEqual(result.tier, 'compartment');
    assert.deepEqual(result.signals, []);
  });

  test('comments and string literals do not grant a broader renderer', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      // document.createElement('canvas');
      const explanation = 'window and WebGLRenderingContext';
      export default explanation;
    `);

    assert.strictEqual(result.tier, 'compartment');
  });
});
