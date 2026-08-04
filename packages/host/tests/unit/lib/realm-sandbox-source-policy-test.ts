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

  test('identifies a format-only import without assigning its sandbox tier', async function (assert) {
    let source = `
      import { CardDef, Component } from '@cardstack/base/card-api';
      import { PlanetEditor, PlanetScene } from './planet-3d';
      export class PlanetCard extends CardDef {
        static isolated = PlanetScene;
        static embedded = PlanetScene;
        static edit = PlanetEditor;
        static atom = class extends Component<typeof this> {
          <template><span>{{@model.name}}</span></template>
        };
      }
    `;
    let result = await classifyCardSourceForSandbox(source);
    let expected = [
      {
        specifier: './planet-3d',
        bindings: [
          { exportName: 'PlanetEditor', formats: ['edit'] },
          {
            exportName: 'PlanetScene',
            formats: ['isolated', 'embedded'],
          },
        ],
      },
    ];

    assert.strictEqual(
      result.tier,
      'compartment',
      'the safe importing module is classified from its own executable code',
    );
    assert.deepEqual(result.formatOnlyImports, expected);
    let compiled = await classifyCardSourceForSandbox(
      await transpileJS(source, '/planet.gts'),
    );
    assert.deepEqual(
      compiled.formatOnlyImports,
      expected,
      'the same convention survives the Realm executable-source transform',
    );
  });

  test('keeps a shared import eager when code outside a full-format slot reads it', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      import { PlanetScene } from './planet-3d';
      export const sceneName = PlanetScene.name;
      export class PlanetCard {
        static isolated = PlanetScene;
      }
    `);

    assert.deepEqual(result.formatOnlyImports, undefined);
  });

  test('DOM globals select the isolated iframe', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      const canvas = document.createElement('canvas');
      export default canvas;
    `);

    assert.strictEqual(result.tier, 'iframe');
    assert.deepEqual(result.signals, ['document']);
    assert.false(
      result.propagatesToImporters,
      'a dormant browser adapter does not force every importer into an iframe',
    );
  });

  test('DOM type annotations do not select an iframe', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      interface Signature {
        Element: HTMLElement;
      }
      export class InteractiveCard {
        change = (event: Event) => {
          return (event.currentTarget as HTMLElement).dataset.rating;
        };
      }
    `);

    assert.strictEqual(result.tier, 'compartment');
    assert.deepEqual(result.signals, []);
  });

  test('executable canvas and pointer methods select an iframe even when DOM names are type-only', async function (assert) {
    let source = `
      export class SignMaker {
        canvas?: HTMLCanvasElement;
        draw(canvas: HTMLCanvasElement, event: PointerEvent) {
          canvas.setPointerCapture(event.pointerId);
          canvas.getContext('2d')?.fillRect(0, 0, 10, 10);
          return canvas.toDataURL('image/png');
        }
      }
    `;
    let authored = await classifyCardSourceForSandbox(source);

    assert.strictEqual(authored.tier, 'iframe');
    assert.deepEqual(authored.signals, [
      'dom-method:getContext',
      'dom-method:setPointerCapture',
      'dom-method:toDataURL',
    ]);
    assert.true(
      authored.propagatesToImporters,
      'an imported canvas implementation carries its iframe requirement',
    );

    let compiled = await classifyCardSourceForSandbox(
      await transpileJS(source, '/sign-maker.gts'),
    );
    assert.strictEqual(compiled.tier, 'iframe');
    assert.deepEqual(compiled.signals, authored.signals);
  });

  test('runtime DOM references still select an iframe when the module also has DOM types', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      interface Signature {
        Element: HTMLElement;
      }
      export function isElement(value: unknown) {
        return value instanceof HTMLElement;
      }
    `);

    assert.strictEqual(result.tier, 'iframe');
    assert.deepEqual(result.signals, ['HTMLElement']);
  });

  test('locally bound browser-named data does not select an iframe', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      export function readToolResult(source: string) {
        let document = JSON.parse(source);
        return document.title;
      }
    `);

    assert.strictEqual(result.tier, 'compartment');
    assert.deepEqual(result.signals, []);
  });

  test('Three.js imports select the isolated iframe', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      import * as THREE from 'https://esm.sh/three@0.160.0';
      export default THREE;
    `);

    assert.strictEqual(result.tier, 'iframe');
    assert.deepEqual(result.signals, ['three']);
    assert.true(
      result.propagatesToImporters,
      'a browser renderer package requirement follows the import graph',
    );
  });

  test('custom modifiers select the isolated iframe because they receive DOM elements', async function (assert) {
    let result = await classifyCardSourceForSandbox(`
      import { modifier } from 'ember-modifier';
      export const measure = modifier((element) => element.clientWidth);
    `);

    assert.strictEqual(result.tier, 'iframe');
    assert.deepEqual(result.signals, ['ember-modifier']);
    assert.true(result.propagatesToImporters);
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

  test('declarative top-layer markup requires an isolated document', async function (assert) {
    let source = `
      import { CardDef, Component } from '@cardstack/base/card-api';
      export class OverlayCard extends CardDef {
        static isolated = class extends Component<typeof this> {
          <template>
            <button popovertarget="overlay">Open</button>
            <aside id="overlay" popover="auto">Overlay</aside>
          </template>
        };
      }
    `;
    let authored = await classifyCardSourceForSandbox(source);
    assert.strictEqual(authored.tier, 'iframe', 'authored GTS selects iframe');
    assert.deepEqual(authored.signals, ['top-layer-markup']);

    let compiled = await classifyCardSourceForSandbox(
      await transpileJS(source, '/top-layer.gts'),
    );
    assert.strictEqual(compiled.tier, 'iframe', 'compiled GTS selects iframe');
    assert.deepEqual(compiled.signals, ['top-layer-markup']);
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
