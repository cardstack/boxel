import { module, test } from 'qunit';

import { themeScope } from '@cardstack/boxel-ui/helpers';

import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  CardContextName,
  CardCrudFunctionsContextName,
  CardURLContextName,
  DefaultFormatsContextName,
  GetCardCollectionContextName,
  GetCardContextName,
  GetCardsContextName,
  PermissionsContextName,
  RealmURLContextName,
  assertBoxelExecutionProtocolVersion,
  assertBoxelExecutionTransportVersion,
  assertKnownRenderDependencies,
  assertSupportedFeatures,
  cardDefFormats,
  fieldDefFormats,
  fileDefFormats,
  formats,
  isValidFormat,
  type RenderDependency,
  type TemplateBundle,
} from '@cardstack/runtime-common';

import {
  classifyBoxelSource,
  executionDecisionForFormat,
} from '@cardstack/host/lib/boxel-source-classifier';

function bundleWith(
  scope: RenderDependency[],
  protocolVersion = BOXEL_EXECUTION_PROTOCOL_VERSION,
): TemplateBundle {
  return {
    protocolVersion,
    root: 'root-template',
    templates: {
      'root-template': {
        id: 'root-template',
        block: '[]',
        moduleName: 'authored-fixture',
        isStrictMode: true,
        stylesheets: [],
        scope,
        instance: { handle: 'instance-1', state: {}, getters: [], actions: [] },
      },
    },
  };
}

module('Unit | rp-protocol-statics', function () {
  // "The renderable format inventory is isolated, embedded, fitted, atom,
  // edit, head, markdown. `metadata` and `form` exist in the `Format` type
  // but are not renderable-format members; they are reserved."
  test('RP-2.1: the renderable format inventory is exactly isolated, embedded, fitted, atom, edit, head, markdown', function (assert) {
    assert.deepEqual(
      [...formats].sort(),
      ['atom', 'edit', 'embedded', 'fitted', 'head', 'isolated', 'markdown'],
      'the inventory holds exactly the seven renderable formats',
    );
    assert.false(
      isValidFormat('metadata'),
      'metadata is reserved, not a renderable-format member',
    );
    assert.false(
      isValidFormat('form'),
      'form is reserved, not a renderable-format member',
    );
    assert.true(
      formats.every((format) => isValidFormat(format)),
      'every inventory member is a valid renderable format',
    );
  });

  // "Per-kind slots: CardDef declares all seven; FieldDef declares embedded,
  // fitted, atom, edit, markdown (no isolated, no head); FileDef declares
  // isolated, embedded, fitted, atom, head, markdown, metadata."
  test('RP-2.2: CardDef, FieldDef, and FileDef declare their per-kind format inventories', function (assert) {
    assert.deepEqual(
      cardDefFormats,
      formats,
      'CardDef declares all seven renderable formats',
    );
    assert.deepEqual(
      [...fieldDefFormats].sort(),
      ['atom', 'edit', 'embedded', 'fitted', 'markdown'],
      'FieldDef declares embedded, fitted, atom, edit, markdown',
    );
    assert.false(
      fieldDefFormats.includes('isolated'),
      'FieldDef declares no isolated slot',
    );
    assert.false(
      fieldDefFormats.includes('head'),
      'FieldDef declares no head slot',
    );
    assert.deepEqual(
      [...fileDefFormats].sort(),
      [
        'atom',
        'embedded',
        'fitted',
        'head',
        'isolated',
        'markdown',
        'metadata',
      ],
      'FileDef declares isolated, embedded, fitted, atom, head, markdown, metadata',
    );
  });

  // "Context tokens are plain string constants in runtime-common."
  test('RP-10.1: context tokens are the documented plain string constants in runtime-common', function (assert) {
    assert.strictEqual(CardContextName, 'card-context');
    assert.strictEqual(
      CardCrudFunctionsContextName,
      'card-crud-functions-context',
    );
    assert.strictEqual(PermissionsContextName, 'permissions-context');
    assert.strictEqual(DefaultFormatsContextName, 'default-format-context');
    assert.strictEqual(CardURLContextName, 'card-url-context');
    assert.strictEqual(RealmURLContextName, 'realm-url-context');
    assert.strictEqual(GetCardContextName, 'get-card-context');
    assert.strictEqual(GetCardsContextName, 'get-cards-context');
    assert.strictEqual(
      GetCardCollectionContextName,
      'get-card-collection-context',
    );
  });

  // "Every record carries the protocol version; consumers check it and fail
  // closed... Semantic and transport versions are independent and both
  // enforced."
  test('RP-14.3: semantic and transport protocol versions are independently enforced and fail closed', function (assert) {
    assert.strictEqual(
      typeof BOXEL_EXECUTION_PROTOCOL_VERSION,
      'number',
      'the semantic protocol version is a published constant',
    );
    assert.strictEqual(
      typeof BOXEL_EXECUTION_TRANSPORT_VERSION,
      'number',
      'the transport version is its own published constant',
    );
    assertBoxelExecutionProtocolVersion(BOXEL_EXECUTION_PROTOCOL_VERSION);
    assertBoxelExecutionTransportVersion(BOXEL_EXECUTION_TRANSPORT_VERSION);
    assert.ok(true, 'the current versions are accepted');
    assert.throws(
      () =>
        assertBoxelExecutionProtocolVersion(
          BOXEL_EXECUTION_PROTOCOL_VERSION + 1,
        ),
      /protocol version/,
      'an unsupported semantic version fails closed with a diagnostic',
    );
    assert.throws(
      () =>
        assertBoxelExecutionTransportVersion(
          BOXEL_EXECUTION_TRANSPORT_VERSION + 1,
        ),
      /transport version/,
      'an unsupported transport version fails closed with its own diagnostic',
    );
  });

  // "`requiredFeatures` is populated by producers and rejected-when-unknown
  // by consumers."
  test('RP-14.3: unknown requiredFeatures reject the whole record; known features pass', function (assert) {
    assertSupportedFeatures(['known-feature'], new Set(['known-feature']));
    assert.ok(true, 'a fully supported feature set is admitted');
    assertSupportedFeatures([], new Set());
    assert.ok(true, 'an empty requirement list needs no features');
    assert.throws(
      () =>
        assertSupportedFeatures(
          ['known-feature', 'future-feature'],
          new Set(['known-feature']),
        ),
      /future-feature/,
      'a required feature the consumer does not know rejects the record and names the feature',
    );
  });

  // "TemplateBundle (validated wire templates + typed dependency union ...);
  // unknown kind rejects the generation."
  test('RP-14.1: a TemplateBundle with an unknown dependency kind or wrong protocol version rejects the whole generation', function (assert) {
    assertKnownRenderDependencies(
      bundleWith([
        { kind: 'authored-component', component: 'child-template' },
        { kind: 'trusted-export', module: '@cardstack/boxel-ui', name: 'cn' },
        { kind: 'literal-value', value: 42 },
      ]),
    );
    assert.ok(true, 'every documented dependency kind is admitted');
    assert.throws(
      () =>
        assertKnownRenderDependencies(
          bundleWith([{ kind: 'live-closure' } as unknown as RenderDependency]),
        ),
      /unknown render dependency kind 'live-closure'/,
      'an unknown dependency kind rejects the generation, never a partial render',
    );
    assert.throws(
      () =>
        assertKnownRenderDependencies(
          bundleWith([], BOXEL_EXECUTION_PROTOCOL_VERSION + 1),
        ),
      /protocol version/,
      'a bundle carrying an unsupported protocol version is rejected before reification',
    );
  });

  // "Compact/non-DOM formats (fitted, atom, head, markdown) of a
  // Sandbox-classified module render in Capsule ... composition never creates
  // inline iframes."
  test('RP-6.3: compact and non-DOM formats of a Sandbox-classified module are contained to Capsule', function (assert) {
    let sandboxDecision = {
      tier: 'sandbox' as const,
      reason: 'browser-runtime:document',
    };
    // `edit` demotes too: the Sandbox has no child→parent write leg, so an
    // iframe edit surface is a structurally read-only dead form — the
    // trusted Base editor must run host-side against the canonical store.
    for (let format of ['fitted', 'atom', 'head', 'markdown', 'edit']) {
      assert.deepEqual(
        executionDecisionForFormat(sandboxDecision, format),
        { tier: 'capsule', reason: `ses-only-format:${format}` },
        `the '${format}' surface of a Sandbox module renders in Capsule with a containment diagnostic`,
      );
    }
    for (let format of ['isolated', 'embedded']) {
      assert.deepEqual(
        executionDecisionForFormat(sandboxDecision, format),
        sandboxDecision,
        `the '${format}' surface keeps the Sandbox decision`,
      );
    }
    // RP-6.3 exception: an authored in-place editor keeps the Sandbox for
    // edit — the SAME retained iframe as its isolated render, so in-iframe
    // state survives the format switch (its write leg is the next
    // milestone). The compact formats still demote even then.
    let inPlaceEditor = { ...sandboxDecision, authoredEditTemplate: true };
    assert.deepEqual(
      executionDecisionForFormat(inPlaceEditor, 'edit'),
      sandboxDecision,
      'an authored `static edit` template keeps the Sandbox iframe for edit',
    );
    assert.deepEqual(
      executionDecisionForFormat(inPlaceEditor, 'fitted'),
      { tier: 'capsule', reason: 'ses-only-format:fitted' },
      'the authored-edit exception never widens the compact formats',
    );
    assert.deepEqual(
      executionDecisionForFormat(sandboxDecision, undefined),
      sandboxDecision,
      'an unspecified format defaults to isolated and keeps the Sandbox decision',
    );
    let capsuleDecision = {
      tier: 'capsule' as const,
      reason: 'default-user-card',
    };
    for (let format of ['isolated', 'fitted', 'atom', 'head', 'markdown']) {
      assert.deepEqual(
        executionDecisionForFormat(capsuleDecision, format),
        capsuleDecision,
        `format containment never changes a Capsule decision ('${format}')`,
      );
    }
  });

  // "Classification is module-based: all formats defined by a module share
  // its route... Authors recover Capsule for compact formats by splitting
  // browser-dependent formats into separate modules."
  test('RP-6.2: classification is module-based, and splitting browser-dependent formats into a separate module recovers Capsule', async function (assert) {
    // One module defining two format components; only the isolated one needs
    // browser authority. The module — and therefore every format it defines —
    // shares the single Sandbox route.
    let mixedModule = await classifyBoxelSource(`
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      export class Mixed extends CardDef {
        get windowTitle() {
          return document.title;
        }
        static isolated = class Isolated extends Component<typeof Mixed> {
          <template><div>{{@model.windowTitle}}</div></template>
        };
        static fitted = class Fitted extends Component<typeof Mixed> {
          <template><div>pure fitted</div></template>
        };
      }
    `);
    assert.strictEqual(
      mixedModule.tier,
      'sandbox',
      'a module whose isolated format needs browser authority routes the whole module to Sandbox',
    );
    assert.true(
      mixedModule.signals.includes('document'),
      'the routing input is the executable browser-global signal',
    );

    // The same compact format split into its own browser-free module
    // classifies independently and recovers the Capsule tier.
    let compactModule = await classifyBoxelSource(`
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      export class Compact extends CardDef {
        static fitted = class Fitted extends Component<typeof Compact> {
          <template><div>pure fitted</div></template>
        };
      }
    `);
    assert.deepEqual(
      { tier: compactModule.tier, reason: compactModule.reason },
      { tier: 'capsule', reason: 'default-user-card' },
      'a split-out module with no browser requirement routes independently to Capsule',
    );
  });

  // "EXCEPTION: a module declaring its own `static edit = …` template (an
  // authored in-place editor) keeps the Sandbox for `edit`."
  test('RP-6.3: classification detects an authored `static edit` template', async function (assert) {
    let inPlace = await classifyBoxelSource(`
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      export class InPlace extends CardDef {
        get windowTitle() { return document.title; }
        static isolated = class Isolated extends Component<typeof InPlace> {
          <template><div>{{@model.windowTitle}}</div></template>
        };
        static edit = class Edit extends Component<typeof InPlace> {
          <template><div>in-place editor</div></template>
        };
      }
    `);
    assert.true(
      inPlace.authoredEditTemplate,
      'a `static edit = …` declaration is detected',
    );

    let standard = await classifyBoxelSource(`
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      export class Standard extends CardDef {
        get windowTitle() { return document.title; }
        static isolated = class Isolated extends Component<typeof Standard> {
          <template><div>{{@model.windowTitle}}</div></template>
        };
      }
    `);
    assert.false(
      standard.authoredEditTemplate,
      'a module without one gets the trusted Base editor host-side',
    );
  });

  // "The scope id is a content hash (theme id + CSS), not a per-process
  // guid, so shared themes emit one stylesheet and prerendered HTML stays
  // stable."
  test('RP-11.3: the theme scope id is a deterministic content hash of theme id + CSS', function (assert) {
    let themeId = 'https://example.test/Theme/midnight';
    let css = ':root{--accent:#2dd4a7;}';
    let first = themeScope(themeId, css);
    let second = themeScope(themeId, css);
    assert.ok(first, 'a theme with an id and CSS resolves a scope token');
    assert.strictEqual(
      first,
      second,
      'the same theme id + CSS always yields the same token (content hash, not a per-process guid)',
    );
    assert.notStrictEqual(
      themeScope(themeId, ':root{--accent:#000000;}'),
      first,
      'changing the CSS changes the token, so differing theme versions cannot share a scope',
    );
    assert.notStrictEqual(
      themeScope('https://example.test/Theme/noon', css),
      first,
      'a different theme id yields a different token',
    );
    assert.strictEqual(
      themeScope(undefined, css),
      undefined,
      'no theme id resolves no scope token',
    );
    assert.strictEqual(
      themeScope(themeId, undefined),
      undefined,
      'no CSS resolves no scope token',
    );
  });
});
