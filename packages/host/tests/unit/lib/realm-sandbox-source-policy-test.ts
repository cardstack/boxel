import { module, test } from 'qunit';

import { transpileJS } from '@cardstack/runtime-common/transpile';

import {
  classifyCardSourceForSandbox,
  sandboxDecisionForFormat,
} from '@cardstack/host/lib/realm-sandbox-source-policy';

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

  test('unscoped template styles require an isolated document', async function (assert) {
    let source = `
      import { CardDef, Component } from '@cardstack/base/card-api';
      export class RetroCard extends CardDef {
        static isolated = class extends Component<typeof this> {
          <template>
            <article>Retro card</article>
            <style>body, button { font-family: serif; }</style>
          </template>
        };
      }
    `;
    let result = await classifyCardSourceForSandbox(source);

    assert.strictEqual(result.tier, 'iframe');
    assert.deepEqual(result.signals, ['unscoped-style']);

    let compiled = await classifyCardSourceForSandbox(
      await transpileJS(source, '/retro-card.gts'),
    );
    assert.strictEqual(
      compiled.tier,
      'iframe',
      'the realm server compiled form selects the same isolated renderer',
    );
    assert.deepEqual(compiled.signals, ['unscoped-style']);

    let scoped = await classifyCardSourceForSandbox(`
      import { CardDef, Component } from '@cardstack/base/card-api';
      export class RetroCard extends CardDef {
        static isolated = class extends Component<typeof this> {
          <template>
            <article>Retro card</article>
            <style scoped>article { font-family: serif; }</style>
          </template>
        };
      }
    `);

    assert.strictEqual(scoped.tier, 'compartment');
    assert.deepEqual(scoped.signals, []);
  });

  test('dynamic inline styles require an isolated document', async function (assert) {
    let source = `
      import { CardDef, Component } from '@cardstack/base/card-api';
      export class StyledCard extends CardDef {
        static isolated = class extends Component<typeof this> {
          style = 'color: rebeccapurple';
          <template><article style={{this.style}}>Styled</article></template>
        };
      }
    `;
    let result = await classifyCardSourceForSandbox(source);
    assert.strictEqual(result.tier, 'iframe', 'authored GTS selects iframe');
    assert.deepEqual(
      result.signals,
      ['dynamic-inline-style'],
      'authored GTS reports the dynamic style signal',
    );

    let compiledSource = await transpileJS(source, '/dynamic-inline-style.gts');
    let compiled = await classifyCardSourceForSandbox(compiledSource);
    assert.strictEqual(compiled.tier, 'iframe', 'compiled GTS selects iframe');
    assert.deepEqual(
      compiled.signals,
      ['dynamic-inline-style'],
      'compiled GTS reports the dynamic style signal',
    );

    let staticStyle = await classifyCardSourceForSandbox(`
      import { CardDef, Component } from '@cardstack/base/card-api';
      export class StyledCard extends CardDef {
        static isolated = class extends Component<typeof this> {
          <template><article style="width: 100%">Styled</article></template>
        };
      }
    `);
    assert.strictEqual(staticStyle.tier, 'compartment');
  });

  test('comments and string literals do not grant a broader renderer', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      // document.createElement('canvas');
      const explanation = 'window and WebGLRenderingContext';
      export default explanation;
    `);

    assert.strictEqual(result.tier, 'compartment');
  });

  test('browser-dependent cards use iframes only for isolated, embedded, and edit', function (assert) {
    let browserDecision = {
      tier: 'iframe' as const,
      reason: 'browser-runtime:three',
    };

    for (let format of ['isolated', 'embedded', 'edit'] as const) {
      assert.strictEqual(
        sandboxDecisionForFormat(browserDecision, format).tier,
        'iframe',
        `${format} may use the DOM-heavy iframe renderer`,
      );
    }
    for (let format of ['fitted', 'atom', 'head', 'markdown'] as const) {
      assert.deepEqual(sandboxDecisionForFormat(browserDecision, format), {
        tier: 'compartment',
        reason: `ses-only-format:${format}`,
      });
    }
  });
});
