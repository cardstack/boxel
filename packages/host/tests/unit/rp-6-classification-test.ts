import * as babel from '@babel/core';
// @ts-ignore no upstream types are available
import typescriptPlugin from '@babel/plugin-transform-typescript';
import { module, test } from 'qunit';

import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';

import {
  BoxelModuleGraphClassifier,
  CLASSIFICATION_REASON_KINDS,
  classifyBoxelSource,
} from '@cardstack/host/lib/boxel-source-classifier';
import {
  isTrustedImport,
  isTrustedModule,
} from '@cardstack/host/lib/trusted-modules';

// The erasure half of what the realm does to card source: the TypeScript
// transform, with the options `packages/runtime-common/transpile.ts` passes it.
// Whether a module name survives this is the fact the classifier's import
// collection has to agree with.
function transformedByRealm(source: string): string {
  return (
    babel.transformSync(source, {
      cwd: '/',
      root: '/',
      envName: 'production',
      filename: 'card.ts',
      babelrc: false,
      configFile: false,
      compact: true,
      plugins: [[typescriptPlugin, { allowDeclareFields: true }]],
    })?.code ?? ''
  );
}

// A card module around whatever the case under test is, so every row of the
// truth table differs only in the fragment being classified.
function card(body: string): string {
  return `
    import { CardDef } from 'https://cardstack.com/base/card-api';
    export class Example extends CardDef {
      ${body}
    }
  `;
}

function isolatedTemplate(markup: string): string {
  return card(`static isolated = class {
    <template>${markup}</template>
  };`);
}

// A loader over a fixed source table that records what it was asked for, so a
// test can assert on fetches not made as well as on classifications reached.
function graphFixture(
  sources: Record<string, string>,
  options: { maxModules?: number } = {},
) {
  let loads: string[] = [];
  let resolutions: string[] = [];
  let classifier = new BoxelModuleGraphClassifier({
    loadSource: async (identifier) => {
      loads.push(identifier);
      let source = sources[identifier];
      if (source === undefined) {
        throw new Error(`no such module: ${identifier}`);
      }
      return source;
    },
    resolveImport: (specifier, relativeTo) => {
      resolutions.push(specifier);
      if (specifier.startsWith('.')) {
        return new URL(specifier, relativeTo).href;
      }
      // A bare specifier resolves to itself, standing in for the loader's
      // package resolution. `unresolvable` is the fixture's one spelling that
      // no resolution exists for.
      if (specifier.startsWith('unresolvable')) {
        throw new Error(`unresolvable specifier: ${specifier}`);
      }
      return specifier;
    },
    isTrustedModule: (identifier) =>
      identifier.startsWith('https://cardstack.com/base/'),
    ...options,
  });
  return { classifier, loads, resolutions, sources };
}

module('Unit | RP-6 classification', function () {
  test('RP-6.4: every browser-only package in the vocabulary promotes its importer', async function (assert) {
    for (let specifier of [
      '@babylonjs/core',
      '@google/model-viewer',
      '@react-three/fiber',
      '@tweenjs/tween.js',
      'aframe',
      'babylonjs',
      'cesium',
      'deck.gl',
      'ember-modifier',
      'konva',
      'leaflet',
      'mapbox-gl',
      'maplibre-gl',
      'p5',
      'paper',
      'pixi.js',
      'potree',
      'three',
      'three-bvh-csg',
      'vtk.js',
    ]) {
      let result = await classifyBoxelSource(
        `import renderer from '${specifier}';\n${card('static renderer = renderer;')}`,
      );
      assert.strictEqual(
        result.tier,
        'sandbox',
        `importing ${specifier} requires a browser`,
      );
      assert.true(
        result.propagatesToImporters,
        `${specifier} is part of an exported render surface, so it promotes importers`,
      );
    }
  });

  test('RP-6.4: a browser-only package is recognized through every spelling that reaches it', async function (assert) {
    for (let specifier of [
      'three',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'https://esm.sh/three@0.160.0',
      'https://esm.sh/three',
      'https://my-realm.example/vendor/three/index.js',
      'https://my-realm.example/vendor/three@0.160.0.js',
    ]) {
      let result = await classifyBoxelSource(
        `import * as THREE from '${specifier}';\n${card('static scene = THREE.Scene;')}`,
      );
      assert.deepEqual(
        result.signals,
        ['three'],
        `${specifier} reports the package signal, not the spelling`,
      );
    }
  });

  test('RP-6.4: a package whose name merely contains a vocabulary entry is not a signal', async function (assert) {
    for (let specifier of [
      'threescore',
      'not-three',
      'https://esm.sh/leaflet-lookalike',
    ]) {
      let result = await classifyBoxelSource(
        `import x from '${specifier}';\n${card('static x = x;')}`,
      );
      assert.strictEqual(
        result.tier,
        'capsule',
        `${specifier} is an ordinary authored dependency`,
      );
    }
  });

  test('RP-6.4: every browser global in the vocabulary is a signal when its reference is unbound', async function (assert) {
    for (let [global, body] of [
      ['CanvasRenderingContext2D', 'static c = CanvasRenderingContext2D;'],
      ['HTMLCanvasElement', 'static c = HTMLCanvasElement;'],
      ['HTMLElement', 'static c = HTMLElement;'],
      ['MutationObserver', 'static c = new MutationObserver(() => {});'],
      ['ResizeObserver', 'static c = new ResizeObserver(() => {});'],
      ['WebGL2RenderingContext', 'static c = WebGL2RenderingContext;'],
      ['WebGLRenderingContext', 'static c = WebGLRenderingContext;'],
      ['customElements', 'static c = customElements.get("x");'],
      ['document', 'static c = document.title;'],
      ['localStorage', 'static c = localStorage.getItem("x");'],
      ['navigator', 'static c = navigator.language;'],
      ['sessionStorage', 'static c = sessionStorage.getItem("x");'],
      ['window', 'static c = window.name;'],
    ] as [string, string][]) {
      let result = await classifyBoxelSource(card(body));
      assert.deepEqual(
        result.signals,
        [global],
        `an unbound ${global} reference is a browser-global signal`,
      );
      assert.strictEqual(result.tier, 'sandbox', `${global} routes to Sandbox`);
      // A static class field is evaluated when the class is defined, which for
      // a top-level class is when the module is initialized — so importing it
      // performs this read.
      assert.true(
        result.propagatesToImporters,
        `a ${global} read at module initialization promotes importers`,
      );
    }
  });

  test('RP-6.4: a global read splits on whether importing the module performs it', async function (assert) {
    for (let [shape, body] of [
      ['a top-level binding', 'export const title = document.title;'],
      ['a top-level statement', 'document.title = "set at import";'],
      [
        'a static class field',
        'export class A { static title = document.title; }',
      ],
      ['a static block', 'export class A { static { document.title = "x"; } }'],
    ] as [string, string][]) {
      let eager = await classifyBoxelSource(body);
      assert.true(
        eager.propagatesToImporters,
        `${shape} runs on import, so its importer needs the same authority`,
      );
    }

    for (let [shape, body] of [
      ['a function body', 'export function read() { return document.title; }'],
      ['a method body', 'export class A { read() { return document.title; } }'],
      ['a getter', 'export class A { get title() { return document.title; } }'],
      ['an instance field', 'export class A { title = document.title; }'],
      [
        'an arrow inside an export',
        'export const read = () => document.title;',
      ],
    ] as [string, string][]) {
      let deferred = await classifyBoxelSource(body);
      assert.strictEqual(
        deferred.tier,
        'sandbox',
        `${shape} still promotes the module that would evaluate it`,
      );
      assert.false(
        deferred.propagatesToImporters,
        `${shape} may never run, so it does not promote importers`,
      );
    }
  });

  test('RP-6.4: every DOM-only method call in the vocabulary is a signal independent of its receiver', async function (assert) {
    for (let method of [
      'getContext',
      'requestPointerLock',
      'setPointerCapture',
      'showModal',
      'toBlob',
      'toDataURL',
    ]) {
      let result = await classifyBoxelSource(
        card(`static probe = (surface) => surface.${method}();`),
      );
      assert.deepEqual(
        result.signals,
        [`dom-method:${method}`],
        `.${method}() acquires browser authority whatever the receiver is annotated as`,
      );
      assert.true(
        result.propagatesToImporters,
        `.${method}() is part of an exported render surface`,
      );
    }
  });

  test('RP-6.4: every template signal in the vocabulary promotes its module', async function (assert) {
    for (let [signal, markup] of [
      ['dynamic-inline-style', '<section style={{@model.tone}}></section>'],
      [
        'dynamic-inline-style',
        `<section style='background: {{@model.tone}}'></section>`,
      ],
      [
        'document-global-style',
        '<i></i><style scoped>@font-face { font-family: CardFont; }</style>',
      ],
      [
        'network-bearing-style',
        '<i></i><style scoped>@import "https://fonts.example/inter.css";</style>',
      ],
      [
        'network-bearing-style',
        '<i></i><style scoped>.t { background: url(https://images.example/bg.png); }</style>',
      ],
      [
        'global-style-selector',
        '<i></i><style scoped>:global(.operator-mode) { font-size: 8rem; }</style>',
      ],
      ['top-layer-markup', '<div popover>Hint</div>'],
      ['unscoped-style', '<i></i><style>.t { color: red; }</style>'],
    ] as [string, string][]) {
      let result = await classifyBoxelSource(isolatedTemplate(markup));
      assert.strictEqual(
        result.tier,
        'sandbox',
        `${signal} needs a document of its own`,
      );
      assert.true(
        result.signals.includes(signal),
        `${markup} reports ${signal}`,
      );
      assert.true(
        result.propagatesToImporters,
        `${signal} is part of an exported render surface`,
      );
    }
  });

  test('RP-6.4: an ordinary authored card with no browser evidence classifies Capsule', async function (assert) {
    let result = await classifyBoxelSource(
      isolatedTemplate(
        '<h1>{{@model.title}}</h1><style scoped>h1 { color: red; }</style>',
      ),
    );
    assert.deepEqual(result, {
      tier: 'capsule',
      reason: 'default-user-card',
      imports: ['https://cardstack.com/base/card-api'],
      signals: [],
      propagatesToImporters: false,
    });
  });

  test('RP-6.4: the trusted custom-property helper is the one admitted dynamic style expression', async function (assert) {
    let helper = await classifyBoxelSource(
      `import { cssVar } from 'https://cardstack.com/base/boxel-ui/helpers';\n${isolatedTemplate(
        '<section style={{cssVar example-accent=@model.accent}}></section>',
      )}`,
    );
    assert.strictEqual(
      helper.tier,
      'capsule',
      'a declaration-only custom-property helper needs no browser global',
    );

    let otherHelper = await classifyBoxelSource(
      isolatedTemplate('<section style={{styleFor @model}}></section>'),
    );
    assert.true(
      otherHelper.signals.includes('dynamic-inline-style'),
      'any other style expression computes a declaration at render time',
    );
  });

  test('RP-6.4: an anonymous @layer block is scoped like any other rule, while a named one is document-global', async function (assert) {
    let anonymous = await classifyBoxelSource(
      isolatedTemplate(
        '<i></i><style scoped>@layer { i { color: red; } }</style>',
      ),
    );
    assert.strictEqual(anonymous.tier, 'capsule');

    let named = await classifyBoxelSource(
      isolatedTemplate(
        '<i></i><style scoped>@layer cards { i { color: red; } }</style>',
      ),
    );
    assert.true(named.signals.includes('document-global-style'));
  });

  test('RP-6.4: a DOM name reachable only through TypeScript syntax requests no authority', async function (assert) {
    for (let body of [
      'element?: HTMLElement;',
      'declare surface: HTMLCanvasElement;',
      'static read = (value: unknown) => value as HTMLElement;',
      'static widen = (value: HTMLElement): HTMLElement => value;',
    ]) {
      let result = await classifyBoxelSource(card(body));
      assert.strictEqual(
        result.tier,
        'capsule',
        `an annotation-only DOM name is erased before evaluation: ${body}`,
      );
    }
  });

  test('RP-6.4: a typeof probe is exempt, and any other reference to the same name is not', async function (assert) {
    let probe = await classifyBoxelSource(
      card(`static hasDOM = typeof window !== 'undefined';`),
    );
    assert.strictEqual(
      probe.tier,
      'capsule',
      'typeof on an unresolvable name evaluates without throwing, so the isomorphic guard runs inside a Compartment',
    );

    let guarded = await classifyBoxelSource(
      card(
        `static width = typeof window !== 'undefined' ? window.innerWidth : 0;`,
      ),
    );
    assert.deepEqual(
      guarded.signals,
      ['window'],
      'the guarded branch still reads the ambient global',
    );
  });

  test('RP-6.4: a lexically bound name that shadows a browser global is ordinary authored data', async function (assert) {
    for (let body of [
      'static read = (document) => document.title;',
      'static read = () => { let document = { title: "x" }; return document.title; };',
      'static read = ({ document }) => document.title;',
      'static read = () => { const { navigator } = { navigator: "x" }; return navigator; };',
    ]) {
      let result = await classifyBoxelSource(card(body));
      assert.strictEqual(
        result.tier,
        'capsule',
        `a bound reference is not an ambient one: ${body}`,
      );
    }
  });

  test('RP-6.4: a browser global named in a comment or a string is not a reference', async function (assert) {
    for (let body of [
      '// this card deliberately avoids document and window\nstatic title = "x";',
      '/* document.createElement is what the Sandbox tier is for */\nstatic title = "x";',
      'static hint = "call document.querySelector to find it";',
      'static hint = `navigator.language decides the format`;',
      `static hint = 'surface.getContext("2d")';`,
    ]) {
      let result = await classifyBoxelSource(card(body));
      assert.strictEqual(
        result.tier,
        'capsule',
        `prose is not authority: ${body}`,
      );
    }
  });

  test('RP-6.4: a browser global reaches the confirmation pass however the surrounding text is quoted', async function (assert) {
    // The prefilter gates the confirmation pass, so a span it wrongly treats
    // as text is a lost signal rather than a lost refinement. These are the
    // shapes that defeat every approximation of "blank the text spans first":
    // a regex literal holding a quote desynchronizes a character-level
    // scanner, and which side of the regex-versus-division question it lands
    // on decides how much of the file goes with it.
    for (let [shape, body] of [
      ['a template interpolation', 'export const l = `${document.title}`;'],
      [
        'a nested template interpolation',
        'export const l = `${`${document.title}`}`;',
      ],
      [
        'an interpolation holding an object literal',
        'export const l = `${ { t: document.title }.t }`;',
      ],
      [
        'a regex in a value position, then a read',
        `const apostrophe = /'/;\nexport const t = document.title;`,
      ],
      [
        'a regex after a keyword, then a read',
        `export function f(){ return /['"]/.test('a'); }\nexport const t = document.title;`,
      ],
      [
        'a regex after a closing brace, then a read',
        `export function f(x){ if (x) {} /['"]/.test('a'); }\nexport const t = document.title;`,
      ],
      [
        'a regex holding an even number of quotes, then a read',
        `export const r = /["']["']/;\nexport const t = document.title;`,
      ],
      [
        'a division, then a read',
        'export const half = 10 / 2, t = document.title;',
      ],
    ] as [string, string][]) {
      let result = await classifyBoxelSource(body);
      assert.deepEqual(
        result.signals,
        ['document'],
        `${shape} reports the global it reads`,
      );
    }

    // The other direction is enforced by the scope-aware pass rather than by
    // guessing which characters were code: prose names a global, and the parse
    // finds no reference to it.
    for (let [shape, body] of [
      [
        'a line comment',
        '// document and window are avoided here\nexport const x = 1;',
      ],
      [
        'a block comment',
        '/* document.createElement is elsewhere */\nexport const x = 1;',
      ],
      ['a string', 'export const hint = "call document.querySelector";'],
      ['a template literal', 'export const l = `see document`;'],
      ['a regex matching the word', 'export const r = /document/;'],
      [
        'a string inside an interpolation',
        'export const l = `${ "document" }`;',
      ],
      [
        'a DOM method name in prose',
        'export const hint = `surface.getContext("2d")`;',
      ],
    ] as [string, string][]) {
      let result = await classifyBoxelSource(body);
      assert.strictEqual(
        result.tier,
        'capsule',
        `${shape} is text, not a reference`,
      );
    }
  });

  test('RP-6.4: a type-only import is erased before the module runs, so it is not a graph edge', async function (assert) {
    for (let [shape, body] of [
      [
        'an import type declaration',
        `import type { Scene } from 'three';\nexport const s: Scene | undefined = undefined;`,
      ],
      ['an export type declaration', `export type { Scene } from 'three';`],
    ] as [string, string][]) {
      let erased = await classifyBoxelSource(body);
      assert.deepEqual(erased.imports, [], `${shape} names no runtime module`);
      assert.strictEqual(
        erased.tier,
        'capsule',
        `${shape} does not route a card to Sandbox for a compile-time reference`,
      );
    }

    // A statement keeps its edge whenever any binding survives erasure. The
    // transform the realm applies drops an import only when every binding it
    // introduces is type-only, so each of these is a real edge — including
    // `import type from`, where `type` is an ordinary default binding, and
    // `{ type as alias }`, which imports the export literally named `type`.
    for (let [shape, body] of [
      [
        'an inline type specifier beside a value',
        `import { type Scene, Group } from 'three';\nexport class C { s?: Scene; g = Group; }`,
      ],
      [
        'a default binding named type',
        `import type from 'three';\nexport const x = type;`,
      ],
      [
        'a default binding named type beside a value',
        `import type, { Group } from 'three';\nexport const x = [type, Group];`,
      ],
      ['a side-effect import', `import 'three';\nexport const x = 1;`],
      [
        'the export named type, aliased',
        `import { type as alias } from 'three';\nexport const x = alias;`,
      ],
    ] as [string, string][]) {
      let kept = await classifyBoxelSource(body);
      assert.deepEqual(kept.imports, ['three'], `${shape} is a runtime edge`);
    }

    // An inline type specifier that leaves nothing bound IS erased by that
    // transform, so it is not an edge either.
    let allInlineTypes = await classifyBoxelSource(
      `import { type Scene } from 'three';\nexport class C { s?: Scene; }`,
    );
    assert.deepEqual(allInlineTypes.imports, []);
    assert.strictEqual(allInlineTypes.tier, 'capsule');

    // A binding whose NAME begins with `type` is not a type-only statement.
    // Reporting one as erased deletes a live edge, which is the unaffordable
    // direction: the module's signals are never gathered and it never enters
    // the graph a Sandbox authorizes reads against — and nothing marks the
    // result incomplete, because nothing failed.
    //
    // `$` and `_` are identifier characters that `\b` does not treat as word
    // characters, so a boundary written that way admits `type$…` while
    // rejecting `types…`.
    for (let binding of [
      'types',
      'typeMap',
      'typeahead',
      'typescriptPlugin',
      'type$',
      'type$$',
      'type$Map',
      'type_',
      'type_map',
    ]) {
      let prefixed = await classifyBoxelSource(
        `import ${binding} from 'three';\nexport default ${binding};`,
      );
      assert.deepEqual(
        prefixed.imports,
        ['three'],
        `a binding named ${binding} is a value, so its edge is real`,
      );
    }

    // The same boundary, with a named value specifier alongside it, so the
    // statement is unambiguously live.
    let prefixedWithNamed = await classifyBoxelSource(
      `import type$, { Group } from 'three';\nexport const x = [type$, Group];`,
    );
    assert.deepEqual(prefixedWithNamed.imports, ['three']);

    // The words in a string are not a declaration.
    let quoted = await classifyBoxelSource(
      `export const hint = "import type { Scene } from 'three'";`,
    );
    assert.deepEqual(quoted.imports, []);
  });

  test('RP-6.4: the ambient global object cannot hide a browser global behind a spelling', async function (assert) {
    for (let expression of [
      'globalThis.document.title',
      'self.document.title',
      'globalThis["document"].title',
      '(() => { let { document } = globalThis; return document.title; })()',
    ]) {
      let named = await classifyBoxelSource(card(`static c = ${expression};`));
      assert.deepEqual(
        named.signals,
        ['document'],
        `${expression} is a reference to document`,
      );
    }

    for (let expression of [
      'globalThis["doc" + "ument"].title',
      'globalThis.crypto.getRandomValues(new Uint8Array(1))',
      '(() => { let { ...rest } = globalThis; return rest; })()',
    ]) {
      let unnamed = await classifyBoxelSource(
        card(`static c = ${expression};`),
      );
      assert.deepEqual(
        unnamed.signals,
        ['window'],
        `${expression} acquires authority this pass cannot name, and is attributed to the global object itself`,
      );
    }

    let shadowed = await classifyBoxelSource(
      card(
        `static c = ((globalThis: { document: string }) => globalThis.document)({ document: 'data' });`,
      ),
    );
    assert.strictEqual(
      shadowed.tier,
      'capsule',
      'a lexically bound globalThis is ordinary authored data',
    );
  });

  test('RP-6.4: a reason string names every signal behind it, in a canonical order', async function (assert) {
    let result = await classifyBoxelSource(
      `import * as THREE from 'three';\n${isolatedTemplate(
        '<canvas style={{@model.tone}}></canvas>',
      ).replace(
        'static isolated',
        'static probe = document.createElement("canvas").getContext("2d");\n      static isolated',
      )}`,
    );
    assert.deepEqual(result.signals, [
      'three',
      'document',
      'dom-method:getContext',
      'dynamic-inline-style',
    ]);
    assert.strictEqual(
      result.reason,
      'browser-runtime:three,document,dom-method:getContext,dynamic-inline-style',
      'the reason is machine-readable: a kind, then its comma-separated signals',
    );
  });

  test('RP-6.4: a literal dynamic import joins the graph as an ordinary edge, and a computed one is dropped', async function (assert) {
    let literal = await classifyBoxelSource(
      card('static load = () => import("three");'),
    );
    assert.deepEqual(
      literal.imports,
      ['https://cardstack.com/base/card-api', 'three'],
      'a literal specifier is statically visible, so it promotes up front',
    );
    assert.strictEqual(literal.tier, 'sandbox');

    let backtick = await classifyBoxelSource(
      card('static load = () => import(`three`);'),
    );
    assert.deepEqual(
      backtick.imports,
      ['https://cardstack.com/base/card-api', 'three'],
      'a template literal with no interpolation is just as knowable as a string',
    );
    assert.strictEqual(backtick.tier, 'sandbox');

    for (let [shape, body] of [
      ['an identifier', 'static load = (name) => import(name);'],
      [
        'an interpolated template',
        'static load = (p) => import(`${p}/three`);',
      ],
      ['a concatenation', 'static load = (p) => import("./" + p);'],
    ] as [string, string][]) {
      let computed = await classifyBoxelSource(card(body));
      assert.deepEqual(
        computed.imports,
        ['https://cardstack.com/base/card-api'],
        `${shape} cannot be statically authorized, and both cages refuse it at runtime`,
      );
    }
  });

  test('RP-6.4: which import statements are edges is held to what the realm erases', async function (assert) {
    // A differential check rather than a table of expected values: each
    // spelling is put through the transform the realm applies to card source,
    // and the classifier has to agree about whether the module survives. A
    // table would encode today's belief; this encodes the realm's behavior, so
    // it also catches the transform changing under us.
    //
    // Each binding is USED on purpose. The transform also drops an import
    // whose bindings are unused, which is a different question from type-ness
    // and one classification deliberately does not model: an unused import
    // that reaches the graph costs a fetch, never a missed signal.
    for (let [statement, use] of [
      [`import type { Scene } from 'three';`, `export class C { s?: Scene; }`],
      [`import type * as T from 'three';`, `export class C { s?: T.Scene; }`],
      [`import type Scene from 'three';`, `export class C { s?: Scene; }`],
      [`import type $Scene from 'three';`, `export class C { s?: $Scene; }`],
      [`import { type Scene } from 'three';`, `export class C { s?: Scene; }`],
      [
        `import { type Scene, Group } from 'three';`,
        `export class C { s?: Scene; g = Group; }`,
      ],
      [`import { type as alias } from 'three';`, `export const x = alias;`],
      [`import { type type } from 'three';`, `export class C { s?: type; }`],
      [`import { type$ } from 'three';`, `export const x = type$;`],
      [`import type from 'three';`, `export const x = type;`],
      [
        `import type, { Group } from 'three';`,
        `export const x = [type, Group];`,
      ],
      [`import type$ from 'three';`, `export const x = type$;`],
      [`import type_ from 'three';`, `export const x = type_;`],
      [`import types from 'three';`, `export const x = types;`],
      [`import 'three';`, `export const x = 1;`],
      [`import {} from 'three';`, `export const x = 1;`],
      [`import type{Scene} from 'three';`, `export class C { s?: Scene; }`],
      [`export type { Scene } from 'three';`, ``],
      [`export { type Scene } from 'three';`, ``],
      [`export type * as ns from 'three';`, ``],
      [`export { types } from 'three';`, ``],
      [`export * from 'three';`, ``],
    ] as [string, string][]) {
      let body = `${statement}\n${use}`;
      let survives = transformedByRealm(body).includes(`'three'`);
      let classified = (await classifyBoxelSource(body)).imports.includes(
        'three',
      );
      assert.strictEqual(
        classified,
        survives,
        `${statement} — the realm ${survives ? 'keeps' : 'erases'} it`,
      );
    }
  });

  test('RP-6.4: an import used only inside a template is still a graph edge', async function (assert) {
    // The most ordinary shape a card has, and the one that rules out deciding
    // erasure from the transform's output: template bodies are blanked before
    // the JavaScript is read, so a component imported only for its template
    // looks unused, and the TypeScript transform drops unused imports.
    let result = await classifyBoxelSource(
      `import Renderer from './renderer.gts';\n${card('static isolated = class { <template><Renderer /></template> };')}`,
    );
    assert.deepEqual(result.imports, [
      './renderer.gts',
      'https://cardstack.com/base/card-api',
    ]);
  });

  test('RP-6.4: syntax the realm serves is analyzed, not mistaken for a draft', async function (assert) {
    // The front-end here is the realm's: content-tag, then Babel's own parser
    // with the same TypeScript plugin. A module the realm can compile has to be
    // analyzed as itself — reading it as an unparseable draft classifies it
    // Capsule and loses whatever it needed.
    //
    // The expression form of `<template>` is the case that matters most,
    // because it is the dominant idiom and because blanking the block — which
    // works for a class member — leaves a hole where an expression belongs.
    for (let [shape, body] of [
      [
        'a template in expression position',
        'const Row = <template>hi</template>;\nexport const t = [Row, document.title];',
      ],
      [
        'a template followed by satisfies',
        'export default <template>hi</template> satisfies unknown;\nexport const t = document.title;',
      ],
      [
        'a template as a default export',
        'export default <template>hi</template>;\nexport const t = document.title;',
      ],
      [
        'an import attribute clause',
        `import data from './data.json' with { type: 'json' };\nexport const t = [data, document.title];`,
      ],
      [
        'a decorator ahead of export',
        'const dec = () => {};\nexport @dec class A { x = document.title; }',
      ],
      [
        'a using declaration',
        'using r = { [Symbol.dispose]() {} };\nexport const t = document.title;',
      ],
      [
        'an await using declaration',
        'export async function f() { await using r = {}; return document.title; }',
      ],
      ['a legacy decorator', 'export class C { @field y = document.title; }'],
      [
        'a generic method',
        'export class C { read<T>(v: T) { return [v, document.title]; } }',
      ],
    ] as [string, string][]) {
      let result = await classifyBoxelSource(body);
      assert.deepEqual(
        result.signals,
        ['document'],
        `${shape} is analyzed, so its read is seen`,
      );
    }
  });

  test('RP-6.4: the import content-tag adds to compile a template is not a graph edge', async function (assert) {
    // content-tag rewrites every `<template>` into a call and imports the
    // compiler to make that call. That import is not something the card's
    // author wrote, so it is not a module the card's graph contains — and a
    // content-tag upgrade that renames it should fail here rather than quietly
    // add a module to every card's graph.
    let result = await classifyBoxelSource(
      `import Renderer from './renderer.gts';\nconst Row = <template><Renderer /></template>;\nexport default Row;`,
    );
    assert.deepEqual(
      result.imports,
      ['./renderer.gts'],
      'the authored edge survives and the injected one does not',
    );
  });

  test('RP-6.1: the trusted boundary admits Cardstack packages and rejects every traversal spelling', function (assert) {
    assert.true(isTrustedModule('@cardstack/base/card-api'));
    assert.true(isTrustedModule('@cardstack/boxel-ui/components'));
    assert.true(isTrustedModule(`${PACKAGES_FAKE_ORIGIN}@cardstack/boxel-ui`));

    for (let identifier of [
      '@cardstack/base/../private/card',
      '@cardstack/base/./card',
      '@cardstack/base/%2e%2e/private/card',
      '@cardstack/base/%252e%252e/private/card',
      '@cardstack/base/..%2fprivate/card',
      '@cardstack/base\\..\\private\\card',
      '@cardstack/base/card?../private',
      '@cardstack/base/card#/../private',
      '@cardstack/',
      '@cardstackish/base/card-api',
    ]) {
      assert.false(
        isTrustedModule(identifier),
        `${identifier} is not a trusted package spelling`,
      );
      assert.false(
        isTrustedImport(identifier),
        `${identifier} is not a Host-provided import either`,
      );
    }
  });

  test('RP-6.1: URL trust is origin-scoped and path-bounded', function (assert) {
    assert.true(
      isTrustedModule('https://cardstack.com/base/card-api'),
      'the canonical Base realm is trusted',
    );
    assert.true(
      isTrustedModule('https://cardstack.com/base'),
      'the boundary directory itself is inside the boundary',
    );
    for (let identifier of [
      'https://cardstack.com/base-evil/card-api',
      'https://cardstack.com/basement/card-api',
      'https://cardstack.com/base/../private/card',
      'https://cardstack.com.evil.example/base/card-api',
      'http://cardstack.com/base/card-api',
      './card-api',
    ]) {
      assert.false(
        isTrustedModule(identifier),
        `${identifier} is outside the trusted Base root`,
      );
    }
  });

  test('RP-6.1: a Host-provided import is not a grant of Direct execution', function (assert) {
    assert.true(isTrustedImport('@glimmer/component'));
    assert.true(
      isTrustedImport(`${PACKAGES_FAKE_ORIGIN}ember-provide-consume-context`),
      'the resolved package facade is Host-provided too',
    );
    assert.false(
      isTrustedModule('@glimmer/component'),
      'a framework stand-in is handed to a cage without making its importer Direct',
    );
    assert.false(
      isTrustedImport('@glimmer/component-extras'),
      'a bare specifier is matched exactly, so a longer name is not admitted by prefix',
    );
  });

  test('RP-6.4: a dependency in the graph promotes the entry, and a trusted import is a leaf', async function (assert) {
    let { classifier, loads, resolutions } = graphFixture({
      'https://example.test/entry.gts': `
        import Renderer from './renderer.gts';
        import { CardDef } from 'https://cardstack.com/base/card-api';
        export class Example extends CardDef { static isolated = Renderer; }
      `,
      'https://example.test/renderer.gts': `
        import * as THREE from 'three';
        export default THREE.Scene;
      `,
    });

    let result = await classifier.classifyModuleGraph(
      'https://example.test/entry.gts',
    );
    assert.strictEqual(result.tier, 'sandbox');
    assert.strictEqual(
      result.reason,
      'dependency-runtime:https://example.test/renderer.gts',
      'the diagnostic names the dependency that carries the evidence',
    );
    assert.deepEqual(result.signals, ['three']);
    assert.deepEqual(
      result.moduleGraph,
      [
        'https://example.test/entry.gts',
        'https://cardstack.com/base/card-api',
        'https://example.test/renderer.gts',
        'three',
      ],
      'the graph is the exact read authorization a stronger runtime gets: entry first, the rest sorted',
    );
    assert.false(
      loads.includes('https://cardstack.com/base/card-api'),
      'a trusted import is a semantic leaf and is never fetched as authored source',
    );
    assert.false(
      resolutions.includes('https://cardstack.com/base/card-api'),
      'nor resolved, which would evaluate the trusted module merely to learn its URL',
    );
  });

  test('RP-6.4: a recognized browser-only package is a graph leaf, and evidence outranks a failure in the same graph', async function (assert) {
    let { classifier, loads } = graphFixture({
      'https://example.test/entry.gts': `
        import * as THREE from 'three';
        import Missing from './missing.gts';
        export default [THREE.Scene, Missing];
      `,
    });
    let result = await classifier.classifyModuleGraph(
      'https://example.test/entry.gts',
    );
    assert.false(
      loads.includes('three'),
      'a package the vocabulary already decides is never fetched as authored source',
    );
    assert.strictEqual(
      result.reason,
      'browser-runtime:three',
      'the actionable signal is reported, not the unrelated load failure that is also true of this graph',
    );
    assert.true(
      result.moduleGraph.includes('three'),
      'the package is still a module the Sandbox may read',
    );
  });

  test('RP-6.4: a dormant browser-global mention inside a dependency does not promote its importer', async function (assert) {
    let { classifier } = graphFixture({
      'https://example.test/entry.gts': `
        import formatted from './library.gts';
        export default formatted;
      `,
      'https://example.test/library.gts': `
        export default function formatted(value) {
          return typeof document === 'undefined' ? value : document.title + value;
        }
      `,
    });

    let dependency = await classifier.classifyModuleGraph(
      'https://example.test/library.gts',
    );
    assert.strictEqual(
      dependency.tier,
      'sandbox',
      'the module that would evaluate the reference is promoted',
    );

    let entry = await classifier.classifyModuleGraph(
      'https://example.test/entry.gts',
    );
    assert.strictEqual(
      entry.tier,
      'capsule',
      'an importer does not inherit a browser adapter that may never run',
    );
  });

  test('RP-6.4: a dependency that reads a browser global on import does promote its importer', async function (assert) {
    let { classifier } = graphFixture({
      'https://example.test/entry.gts': `
        import { title } from './library.gts';
        export default title;
      `,
      // Not dormant: loading the importer evaluates this read, so an importer
      // in a Capsule would break on the very import.
      'https://example.test/library.gts': `export const title = document.title;`,
    });

    let entry = await classifier.classifyModuleGraph(
      'https://example.test/entry.gts',
    );
    assert.strictEqual(entry.tier, 'sandbox');
    assert.strictEqual(
      entry.reason,
      'dependency-runtime:https://example.test/library.gts',
    );
    assert.deepEqual(entry.signals, ['document']);
  });

  test('RP-6.4: a draft answers only the caller that supplied it, and never de-escalates another card', async function (assert) {
    // The per-module memo answers every entry that reaches an identifier, so a
    // draft seated in it would let an unsaved editor buffer decide an
    // unrelated card. The downward direction is the one RP-6.1 R5 forbids.
    for (let [shape, saved, draft, expected] of [
      [
        'a draft that would promote',
        `export const v = 1;`,
        `import * as THREE from 'three'; export const v = THREE.Scene;`,
        'capsule',
      ],
      [
        'a draft that would de-escalate',
        `import * as THREE from 'three'; export const v = THREE.Scene;`,
        `export const v = 1;`,
        'sandbox',
      ],
    ] as [string, string, string, string][]) {
      let shared = 'https://example.test/shared.gts';
      let { classifier, loads } = graphFixture({
        'https://example.test/card.gts': `import { v } from './shared.gts'; export default v;`,
        [shared]: saved,
      });

      let drafted = await classifier.classifyModuleGraph(shared, draft);
      assert.strictEqual(
        drafted.tier,
        draft.includes('three') ? 'sandbox' : 'capsule',
        `${shape} decides its own entry`,
      );

      let card = await classifier.classifyModuleGraph(
        'https://example.test/card.gts',
      );
      assert.strictEqual(
        card.tier,
        expected,
        `${shape} does not reach a card it is not the source of`,
      );
      assert.true(
        loads.includes(shared),
        `${shape} leaves the saved module to be read from the loader`,
      );
    }
  });

  test('RP-6.4: a realm module under a path segment the vocabulary matches is walked, not pruned', async function (assert) {
    // The signal vocabulary matches a vendored copy by path segment, which is
    // wanted — it still promotes its importer. But its dependencies are
    // separate modules the realm serves, and `moduleGraph` is what a Sandbox
    // authorizes reads against, so pruning it would turn an iframe into a
    // refused fetch.
    let { classifier } = graphFixture({
      'https://example.test/card.gts': `import n from './paper/note.gts'; export default n;`,
      'https://example.test/paper/note.gts': `import h from './helper.gts'; export default h;`,
      'https://example.test/paper/helper.gts': `export default 1;`,
    });

    let result = await classifier.classifyModuleGraph(
      'https://example.test/card.gts',
    );
    assert.strictEqual(result.reason, 'browser-runtime:paper');
    assert.deepEqual(result.moduleGraph, [
      'https://example.test/card.gts',
      'https://example.test/paper/helper.gts',
      'https://example.test/paper/note.gts',
    ]);
  });

  test('RP-6.4: a bundled browser-only package is a leaf, so its source is never fetched', async function (assert) {
    for (let specifier of ['three', 'https://esm.sh/three@0.160.0']) {
      let { classifier, loads } = graphFixture({
        'https://example.test/card.gts': `import * as THREE from '${specifier}'; export default THREE.Scene;`,
      });
      let result = await classifier.classifyModuleGraph(
        'https://example.test/card.gts',
      );
      assert.strictEqual(result.reason, 'browser-runtime:three');
      assert.false(
        loads.includes(specifier),
        `${specifier} is served as a bundle, so it is not fetched as authored source`,
      );
      assert.true(
        result.moduleGraph.includes(specifier),
        `${specifier} is still a module the Sandbox may read`,
      );
    }
  });

  test("RP-6.1: a dependency whose source does not parse fails the graph closed, unlike the entry's own draft", async function (assert) {
    let { classifier } = graphFixture({
      'https://example.test/card.gts': `import d from './draft.gts'; export default d;`,
      'https://example.test/draft.gts': `export default class { <template><h1>unclosed`,
    });

    let entry = await classifier.classifyModuleGraph(
      'https://example.test/draft.gts',
    );
    assert.strictEqual(
      entry.reason,
      'source-parse-pending',
      'the module being edited keeps the more restrictive renderer, so the last good render stays up',
    );

    let importer = await classifier.classifyModuleGraph(
      'https://example.test/card.gts',
    );
    assert.strictEqual(
      importer.tier,
      'sandbox',
      'but nothing established that dependency closure, which RP-6.1 R2 fails closed',
    );
    assert.strictEqual(
      importer.reason,
      'module-parse:https://example.test/draft.gts',
    );
  });

  test('RP-6.4: a module whose source did not parse is re-read rather than pinned to the draft', async function (assert) {
    let sources: Record<string, string> = {
      'https://example.test/draft.gts': `export default class { <template><h1>unclosed`,
    };
    let { classifier, loads } = graphFixture(sources);
    let entry = 'https://example.test/draft.gts';

    assert.strictEqual(
      (await classifier.classifyModuleGraph(entry)).reason,
      'source-parse-pending',
      'an unparseable draft fails into Capsule',
    );

    sources[entry] =
      `import * as THREE from 'three'; export default THREE.Scene;`;
    let settled = await classifier.classifyModuleGraph(entry);
    assert.strictEqual(
      settled.reason,
      'browser-runtime:three',
      'and the next classification re-reads it instead of reusing the draft result',
    );
    assert.deepEqual(loads, [entry, entry]);
  });

  test('RP-6.4: an entry decided over an unparseable dependency is re-decided once it parses', async function (assert) {
    let sources: Record<string, string> = {
      'https://example.test/entry.gts': `import Draft from './draft.gts'; export default Draft;`,
      'https://example.test/draft.gts': `export default class { <template><h1>unclosed`,
    };
    let { classifier } = graphFixture(sources);
    let entry = 'https://example.test/entry.gts';

    assert.strictEqual(
      (await classifier.classifyModuleGraph(entry)).reason,
      'module-parse:https://example.test/draft.gts',
    );

    // Nothing invalidates the dependency by name: the entry is not kept,
    // because the walk that produced it could not establish the graph.
    sources['https://example.test/draft.gts'] =
      `import * as THREE from 'three'; export default THREE.Scene;`;
    assert.strictEqual(
      (await classifier.classifyModuleGraph(entry)).reason,
      'dependency-runtime:https://example.test/draft.gts',
    );
  });

  test('RP-6.4: promotion is computed from the finished graph, so import order and cycles cannot change it', async function (assert) {
    let sources = {
      'https://example.test/left.gts': `import Shared from './shared.gts'; export default Shared;`,
      'https://example.test/right.gts': `import Shared from './shared.gts'; export default Shared;`,
      'https://example.test/shared.gts': `import * as THREE from 'three'; export default THREE.Scene;`,
      'https://example.test/cycle-a.gts': `import B from './cycle-b.gts'; export default B;`,
      'https://example.test/cycle-b.gts': `import A from './cycle-a.gts'; import * as THREE from 'three'; export default A || THREE.Scene;`,
    };
    let { classifier } = graphFixture(sources);
    let diamond = (imports: string) =>
      `${imports}\nexport default [Left, Right];`;

    // Two fresh classifiers, so the second call actually traverses rather than
    // answering from the memo the first call filled — which would prove cache
    // reuse instead of order independence.
    let leftFirst = await classifier.classifyModuleGraph(
      'https://example.test/entry.gts',
      diamond(
        `import Left from './left.gts'; import Right from './right.gts';`,
      ),
    );
    let rightFirst = await graphFixture(sources).classifier.classifyModuleGraph(
      'https://example.test/entry.gts',
      diamond(
        `import Right from './right.gts'; import Left from './left.gts';`,
      ),
    );
    assert.strictEqual(leftFirst.tier, 'sandbox');
    assert.deepEqual(
      { tier: rightFirst.tier, reason: rightFirst.reason },
      { tier: leftFirst.tier, reason: leftFirst.reason },
      'a diamond reached from either side yields the same tier and the same diagnostic',
    );
    assert.deepEqual(rightFirst.signals, leftFirst.signals);
    assert.deepEqual(rightFirst.moduleGraph, leftFirst.moduleGraph);

    // Entered from either end, on classifiers that have not seen the cycle.
    for (let entry of ['cycle-a.gts', 'cycle-b.gts']) {
      let cycle = await graphFixture(sources).classifier.classifyModuleGraph(
        `https://example.test/${entry}`,
      );
      assert.strictEqual(
        cycle.tier,
        'sandbox',
        `evidence survives a cycle entered at ${entry}`,
      );
    }
  });

  test('RP-6.4: the per-module memo is shared across entries, so a second card re-fetches and re-analyzes nothing it shares', async function (assert) {
    let sources: Record<string, string> = {
      'https://example.test/first.gts': `
        import a from './shared-a.gts';
        import b from './shared-b.gts';
        export default [a, b];
      `,
      'https://example.test/second.gts': `
        import a from './shared-a.gts';
        import b from './shared-b.gts';
        export default { a, b };
      `,
      'https://example.test/shared-a.gts': `export default 'a';`,
      'https://example.test/shared-b.gts': `export default 'b';`,
    };
    let { classifier, loads } = graphFixture(sources);

    let first = await classifier.classifyModuleGraph(
      'https://example.test/first.gts',
    );
    assert.strictEqual(first.tier, 'capsule');
    assert.deepEqual(
      [...loads].sort(),
      [
        'https://example.test/first.gts',
        'https://example.test/shared-a.gts',
        'https://example.test/shared-b.gts',
      ],
      'the first entry pays for its whole graph',
    );

    // Whatever the loader would now serve for the shared modules is a
    // different classification, so reaching them again would be visible in the
    // result as well as in the load log.
    sources['https://example.test/shared-a.gts'] =
      `import * as THREE from 'three'; export default THREE.Scene;`;
    sources['https://example.test/shared-b.gts'] =
      `import * as THREE from 'three'; export default THREE.Scene;`;
    loads.length = 0;

    let second = await classifier.classifyModuleGraph(
      'https://example.test/second.gts',
    );
    assert.deepEqual(
      loads,
      ['https://example.test/second.gts'],
      'the second entry fetches only the module it does not share',
    );
    assert.strictEqual(
      second.tier,
      'capsule',
      'and re-analyzes nothing: the shared subtree keeps its memoized classification',
    );
    assert.deepEqual(second.moduleGraph, [
      'https://example.test/second.gts',
      'https://example.test/shared-a.gts',
      'https://example.test/shared-b.gts',
    ]);
  });

  test('RP-6.4: an unchanged draft reuses its whole result, and a changed one re-decides the entry without re-fetching the graph below it', async function (assert) {
    let { classifier, loads } = graphFixture({
      'https://example.test/dependency.gts': `export default class Dependency {}`,
    });
    let entry = 'https://example.test/entry.gts';
    let source = `
      import Dependency from './dependency.gts';
      export class Example extends Dependency {}
    `;

    let first = classifier.classifyModuleGraph(entry, source);
    let second = classifier.classifyModuleGraph(entry, source);
    assert.strictEqual(
      first,
      second,
      'an identical draft hashes to the entry memo and does no work at all',
    );
    await second;
    assert.deepEqual(loads, ['https://example.test/dependency.gts']);

    let changed = await classifier.classifyModuleGraph(
      entry,
      `${source}\nimport * as THREE from 'three';`,
    );
    assert.strictEqual(
      changed.tier,
      'sandbox',
      'a changed draft is re-analyzed rather than answered from the memo',
    );
    assert.deepEqual(
      loads,
      ['https://example.test/dependency.gts'],
      'and the unchanged modules below it are still not re-fetched: the module memo is keyed per module, not per entry revision',
    );
  });

  test('RP-6.4: invalidating a module evicts it and every entry whose graph reached it', async function (assert) {
    let sources: Record<string, string> = {
      'https://example.test/entry.gts': `import Shared from './shared.gts'; export default Shared;`,
      'https://example.test/shared.gts': `export default 'plain';`,
    };
    let { classifier } = graphFixture(sources);
    let entry = 'https://example.test/entry.gts';
    let shared = 'https://example.test/shared.gts';

    assert.strictEqual(
      (await classifier.classifyModuleGraph(entry)).tier,
      'capsule',
    );

    sources[shared] =
      `import * as THREE from 'three'; export default THREE.Scene;`;
    assert.strictEqual(
      (await classifier.classifyModuleGraph(entry)).tier,
      'capsule',
      'an entry keeps its answer until something says the graph moved',
    );

    classifier.invalidate(shared);
    let promoted = await classifier.classifyModuleGraph(entry);
    assert.strictEqual(
      promoted.reason,
      `dependency-runtime:${shared}`,
      'invalidating a dependency re-decides every importer of it, not only the dependency',
    );
  });

  test('RP-6.4: graph completeness is reported separately from the reason, because a finding can outrank a failure in the same graph', async function (assert) {
    // A complete walk.
    let clean = graphFixture({
      'https://example.test/entry.gts': `export const t = document.title;`,
    });
    let settled = await clean.classifier.classifyModuleGraph(
      'https://example.test/entry.gts',
    );
    assert.strictEqual(settled.reason, 'browser-runtime:document');
    assert.true(
      settled.moduleGraphComplete,
      'nothing in this graph went unread',
    );

    // The same finding, over a graph with an unreadable member. Positive
    // evidence is reported ahead of the failure, so the reason alone cannot
    // tell a consumer that the list stops short.
    let truncated = graphFixture({
      'https://example.test/entry.gts': `import dep from './dep.gts';\nexport const t = document.title;`,
    });
    let partial = await truncated.classifier.classifyModuleGraph(
      'https://example.test/entry.gts',
    );
    assert.strictEqual(
      partial.reason,
      'browser-runtime:document',
      'the actionable signal still wins the diagnostic',
    );
    assert.false(
      partial.moduleGraphComplete,
      'but the graph is not an authorization list: a Sandbox checking fetches against it would refuse the dependency',
    );

    // And such a result is not kept, so asking again re-reads rather than
    // returning the truncated answer. Awaited first: two calls in one tick
    // deliberately share the in-flight walk, and the eviction runs when it
    // settles.
    truncated.loads.length = 0;
    await truncated.classifier.classifyModuleGraph(
      'https://example.test/entry.gts',
    );
    assert.deepEqual(
      truncated.loads,
      ['https://example.test/dep.gts'],
      'an incomplete walk is never memoized, so the next request re-reads the module it could not read — and only that one, since the entry itself was read fine',
    );
  });

  test('RP-6.1: an unresolvable import fails the graph closed, with a diagnostic that does not depend on traversal order', async function (assert) {
    let unresolvable = (imports: string) => ({
      'https://example.test/entry.gts': `${imports}\nexport default [a, b];`,
    });

    for (let imports of [
      `import a from 'unresolvable-alpha'; import b from 'unresolvable-beta';`,
      `import b from 'unresolvable-beta'; import a from 'unresolvable-alpha';`,
    ]) {
      let { classifier } = graphFixture(unresolvable(imports));
      let result = await classifier.classifyModuleGraph(
        'https://example.test/entry.gts',
      );
      assert.strictEqual(
        result.tier,
        'sandbox',
        'a graph we cannot establish gets the strongest cage',
      );
      assert.strictEqual(
        result.reason,
        'module-resolve:unresolvable-alpha',
        'the reported failure is a property of the graph, not of the order its imports appear in',
      );
    }
  });

  test('RP-6.1: a dependency whose source cannot be loaded fails the graph closed', async function (assert) {
    let { classifier } = graphFixture({
      'https://example.test/entry.gts': `import Missing from './missing.gts'; export default Missing;`,
    });
    let result = await classifier.classifyModuleGraph(
      'https://example.test/entry.gts',
    );
    assert.strictEqual(result.tier, 'sandbox');
    assert.strictEqual(
      result.reason,
      'module-load:https://example.test/missing.gts',
    );
    assert.deepEqual(
      result.moduleGraph,
      ['https://example.test/entry.gts', 'https://example.test/missing.gts'],
      'the graph still reports what it reached, so the diagnostic can be read against it',
    );
  });

  test('RP-6.1: a failed classification is not memoized, so the next request retries it', async function (assert) {
    let sources: Record<string, string> = {
      'https://example.test/entry.gts': `import Late from './late.gts'; export default Late;`,
    };
    let { classifier } = graphFixture(sources);
    let entry = 'https://example.test/entry.gts';

    assert.strictEqual(
      (await classifier.classifyModuleGraph(entry)).reason,
      'module-load:https://example.test/late.gts',
    );

    sources['https://example.test/late.gts'] = `export default 'now here';`;
    assert.strictEqual(
      (await classifier.classifyModuleGraph(entry)).tier,
      'capsule',
      'a transient fetch failure is not pinned into the cache',
    );
  });

  test('RP-6.4: a graph larger than its bound fails closed, and the bound is reported ahead of any other failure', async function (assert) {
    // `aa-missing` fails to load before the bound is reached, so both a
    // per-module failure and the bound are in play at once.
    let { classifier } = graphFixture(
      {
        'https://example.test/a.gts': `import m from './aa-missing.gts'; import b from './zz-b.gts'; export default [m, b];`,
        'https://example.test/zz-b.gts': `import c from './zz-c.gts'; export default c;`,
        'https://example.test/zz-c.gts': `export default 'c';`,
      },
      { maxModules: 2 },
    );
    let result = await classifier.classifyModuleGraph(
      'https://example.test/a.gts',
    );
    assert.strictEqual(result.tier, 'sandbox');
    assert.strictEqual(
      result.reason,
      'module-graph-limit',
      'once the walk stops early, which other modules failed is an artifact of where it stopped',
    );
  });

  test('RP-6.4: a graph that exactly fits its bound is not a failure', async function (assert) {
    let { classifier } = graphFixture(
      {
        'https://example.test/a.gts': `import b from './b.gts'; export default b;`,
        'https://example.test/b.gts': `export default 'b';`,
      },
      { maxModules: 2 },
    );
    assert.strictEqual(
      (await classifier.classifyModuleGraph('https://example.test/a.gts')).tier,
      'capsule',
    );
  });

  test('RP-6.4: every declared reason kind is reachable, so the diagnostics catalog has no dead entries', async function (assert) {
    let sources: Record<string, string> = {
      'https://example.test/plain.gts': `export default 'plain';`,
      'https://example.test/own.gts': `export default document.title;`,
      'https://example.test/importer.gts': `import x from './renderer.gts'; export default x;`,
      'https://example.test/renderer.gts': `import * as THREE from 'three'; export default THREE.Scene;`,
      'https://example.test/missing-dep.gts': `import x from './nowhere.gts'; export default x;`,
      'https://example.test/bad-specifier.gts': `import x from 'unresolvable'; export default x;`,
      'https://example.test/draft.gts': `export default class { <template><h1>unclosed`,
      'https://example.test/parse-dep.gts': `import d from './draft.gts'; export default d;`,
      'https://example.test/deep.gts': `import x from './importer.gts'; export default x;`,
    };
    let { classifier } = graphFixture(sources);
    let bounded = graphFixture(sources, { maxModules: 1 }).classifier;

    let reasonFor = async (
      entry: string,
      using = classifier,
    ): Promise<string> =>
      (await using.classifyModuleGraph(`https://example.test/${entry}`)).reason;

    // `module-analysis` is the fallback for a failure with no more specific
    // cause, reached here by an option that throws rather than returning.
    let throwingOption = new BoxelModuleGraphClassifier({
      loadSource: async () => `import x from 'anything'; export default x;`,
      resolveImport: (specifier) => specifier,
      isTrustedModule: () => {
        throw new Error('an option that throws is not a graph failure kind');
      },
    });

    let observed = new Set([
      await reasonFor('plain.gts'),
      await reasonFor('own.gts'),
      await reasonFor('importer.gts'),
      await reasonFor('missing-dep.gts'),
      await reasonFor('bad-specifier.gts'),
      await reasonFor('draft.gts'),
      await reasonFor('parse-dep.gts'),
      await reasonFor('deep.gts', bounded),
      await reasonFor('plain.gts', throwingOption),
    ]);
    let observedKinds = new Set(
      [...observed].map((reason) => reason.split(':')[0]),
    );

    assert.deepEqual(
      [...CLASSIFICATION_REASON_KINDS].filter(
        (kind) => !observedKinds.has(kind),
      ),
      [],
      'every declared reason kind is produced here',
    );
  });
});
