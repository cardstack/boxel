import { module, test } from 'qunit';

import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  BOXEL_RUNTIME_OPERATIONS,
  COMPONENT_EFFECT_KINDS,
  PROJECTED_ERROR_MAX_TEXT_LENGTH,
  MATERIALIZATION_PURPOSES,
  PROJECTED_ERROR_MAX_CAUSE_DEPTH,
  PROTOCOL_REFUSAL_CODES,
  ProtocolRefusal,
  SAFE_EVENT_BOOLEAN_PROPERTIES,
  SAFE_EVENT_NULLABLE_STRING_PROPERTIES,
  SAFE_EVENT_NUMBER_PROPERTIES,
  SAFE_EVENT_STRING_PROPERTIES,
  SAFE_EVENT_TARGET_BOOLEAN_PROPERTIES,
  SAFE_EVENT_TARGET_NUMBER_PROPERTIES,
  SAFE_EVENT_TARGET_SCALAR_PROPERTIES,
  SAFE_EVENT_TARGET_STRING_PROPERTIES,
  TEMPLATE_DEPENDENCY_KINDS,
  assertExecutionTransportVersion,
  acceptComponentUpdate,
  acceptTemplateBundle,
  assertUsableExecutionRecord,
  childFieldFormatsFor,
  isBoxelValueReference,
  projectDataset,
  projectError,
} from '@cardstack/runtime-common/boxel-execution-protocol';
import type {
  BoxelDescription,
  ComponentUpdate,
  InstanceProjection,
  ProjectedError,
  ProtocolSupport,
  ResolvedField,
  SafeEvent,
  TemplateBundle,
  TemplateDependency,
} from '@cardstack/runtime-common/boxel-execution-protocol';
import { formats } from '@cardstack/runtime-common/formats';
import type { Format } from '@cardstack/runtime-common/formats';
import { rri } from '@cardstack/runtime-common/realm-identifiers';

const support: ProtocolSupport = {
  protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
  features: new Set<string>(),
};

const testRef = { module: rri('http://test/person'), name: 'Person' };

function description(
  overrides: Partial<BoxelDescription> = {},
): BoxelDescription {
  return {
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    requiredFeatures: [],
    ref: testRef,
    boxelKind: 'card',
    ancestors: [{ module: rri('@cardstack/base/card-api'), name: 'CardDef' }],
    fields: [
      {
        fieldName: 'title',
        type: { module: rri('@cardstack/base/string'), name: 'default' },
        kind: 'contains',
        isComputed: false,
      },
    ],
    formats: [
      { format: 'isolated', provider: { kind: 'authored', ref: testRef } },
    ],
    presentation: {
      displayName: 'Person',
      headerColor: null,
      prefersWideFormat: false,
    },
    executionHints: { prefersFullSandbox: false },
    ...overrides,
  };
}

function resolvedField(): ResolvedField {
  return {
    fieldName: 'title',
    type: { module: rri('@cardstack/base/string'), name: 'default' },
    kind: 'contains',
    isComputed: false,
    resolvedConfiguration: { placeholder: 'Name' },
  };
}

function projectedError(): ProjectedError {
  return {
    name: 'Error',
    message: 'render failed',
    stack: 'at Component.render',
    cause: { name: 'TypeError', message: 'total is not a function' },
  };
}

function projection(
  overrides: Partial<InstanceProjection> = {},
): InstanceProjection {
  return {
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    requiredFeatures: [],
    id: rri('http://test/people/1'),
    type: testRef,
    revision: 3,
    model: {
      title: 'Ada',
      vendor: { $boxel: { id: 'http://test/vendors/1', type: testRef } },
    },
    presentation: {
      title: 'Ada',
      summary: null,
      thumbnailURL: null,
      isThemed: true,
      theme: { $boxel: { id: rri('http://test/themes/1'), type: testRef } },
      themeScope: 'http://test/themes/1-9f2c1a',
      themeCss: '--boxel-accent: rebeccapurple;',
      cssImports: ['https://fonts.example/inter.css'],
    },
    ...overrides,
  };
}

function bundle(scope: TemplateDependency[] = []): TemplateBundle {
  return {
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    requiredFeatures: [],
    root: 'template-0',
    templates: {
      'template-0': {
        id: 'template-0',
        block: '[[[1,"h1",[],[],[[2,"title"]]]]]',
        moduleName: 'http://test/person.gts',
        isStrictMode: true,
        stylesheets: ['http://test/person.glimmer-scoped.css'],
        scope,
        instance: {
          handle: 'instance-0',
          state: { title: 'Ada' },
          getters: ['fullName'],
          actions: ['rename'],
        },
      },
    },
  };
}

function update(overrides: Partial<ComponentUpdate> = {}): ComponentUpdate {
  return {
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    requiredFeatures: [],
    generation: 7,
    changed: { title: 'Grace' },
    effects: [{ kind: 'view-card', payload: { cardId: 'http://test/x' } }],
    ...overrides,
  };
}

function safeEvent(): SafeEvent {
  return {
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    requiredFeatures: [],
    type: 'click',
    bubbles: true,
    cancelable: true,
    composed: true,
    defaultPrevented: false,
    target: {
      tagName: 'INPUT',
      value: 'Ada',
      checked: false,
      dataset: { testId: 'name' },
    },
    currentTarget: null,
    clientX: 12,
    clientY: 40,
    altKey: false,
  };
}

// Records the member names a gate touched, so a test can show the gate
// decided from the envelope alone.
//
// Traps `getOwnPropertyDescriptor` rather than `get`, because that is how a
// gate reads: property access would run an accessor, and a gate never does.
// A `get` trap here would record nothing and the assertion would pass
// vacuously.
function watched<T extends object>(record: T, seen: string[]): T {
  return new Proxy(record, {
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string') {
        seen.push(key);
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key, receiver) {
      if (typeof key === 'string') {
        seen.push(`get:${key}`);
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

module('Unit | rendering protocol | records and operations', function () {
  // The cascade Base applies, stated independently of Base's own
  // implementation: `defaultFieldFormats` is module-private in
  // field-component.gts, so this table is the comparison, and a change to
  // either side has to be argued for against it.
  const cascade: [string, Format, Format][] = [
    ['edit', 'edit', 'edit'],
    ['isolated', 'embedded', 'fitted'],
    ['embedded', 'embedded', 'fitted'],
    ['fitted', 'embedded', 'fitted'],
    ['atom', 'atom', 'atom'],
    ['head', 'head', 'head'],
    ['markdown', 'markdown', 'markdown'],
    ['metadata', 'embedded', 'fitted'],
    ['form', 'embedded', 'fitted'],
    ['a-format-nobody-declared', 'embedded', 'fitted'],
  ];

  test('RP-2.6: one child-format cascade answers for every format, known or not', function (assert) {
    for (let [containing, fieldDef, cardDef] of cascade) {
      assert.deepEqual(
        childFieldFormatsFor(containing),
        { fieldDef, cardDef },
        `${containing} nests {fieldDef: ${fieldDef}, cardDef: ${cardDef}}`,
      );
    }

    let covered = new Set(cascade.map(([containing]) => containing));
    for (let format of formats) {
      assert.true(
        covered.has(format),
        `${format} is a renderable format, so the cascade table must state its children`,
      );
    }
  });

  test('RP-2.6: edit, atom, head and markdown are fixed points and the display formats stabilize', function (assert) {
    for (let format of ['edit', 'atom', 'head', 'markdown'] as const) {
      assert.deepEqual(
        childFieldFormatsFor(format),
        { fieldDef: format, cardDef: format },
        `${format} recurses in itself`,
      );
    }
    // Re-deriving from either axis of the display answer returns that same
    // answer, so nesting depth cannot walk the tree into a third state.
    for (let format of ['embedded', 'fitted'] as const) {
      assert.deepEqual(childFieldFormatsFor(format), {
        fieldDef: 'embedded',
        cardDef: 'fitted',
      });
    }
  });

  test('RP-14.1: a record of each shape survives structuredClone unchanged', function (assert) {
    for (let [name, record] of [
      ['BoxelDescription', description()],
      ['InstanceProjection', projection()],
      ['TemplateBundle', bundle([{ kind: 'literal-value', value: 42 }])],
      ['ComponentUpdate', update()],
      ['SafeEvent', safeEvent()],
      ['ResolvedField', resolvedField()],
      ['ProjectedError', projectedError()],
    ] as const) {
      assert.deepEqual(
        structuredClone(record),
        record,
        `${name} crosses a boundary intact`,
      );
    }
  });

  test('RP-14.1: a projected link is exactly {$boxel: {id, type}} with a resolvable code ref', function (assert) {
    assert.true(
      isBoxelValueReference({ $boxel: { id: 'http://test/x', type: testRef } }),
      'a saved link',
    );
    assert.true(
      isBoxelValueReference({ $boxel: { id: null, type: testRef } }),
      'a link to an unsaved target',
    );

    // Each of these is an expanded graph, or a step toward one, wearing a
    // reference's marker.
    assert.false(
      isBoxelValueReference({
        $boxel: { id: 'http://test/x', type: testRef },
        attributes: { title: 'Ada' },
      }),
      'a sibling member alongside the marker',
    );
    assert.false(
      isBoxelValueReference({
        $boxel: {
          id: 'http://test/x',
          type: testRef,
          // Sorts after `type`, so this fails on the marker's exact key count
          // rather than on the key-name comparison.
          value: { title: 'Ada' },
        },
      }),
      'the target embedded inside the marker',
    );
    assert.false(
      isBoxelValueReference({ $boxel: { id: 'http://test/x' } }),
      'no type to resolve against',
    );

    // The marker's shape is not the whole contract: a consumer resolves the
    // ref, so a ref that is merely object-shaped must not narrow.
    assert.true(
      isBoxelValueReference({
        $boxel: { id: null, type: { type: 'ancestorOf', card: testRef } },
      }),
      'a code ref may be one of the recursive forms',
    );
    assert.true(
      isBoxelValueReference({
        $boxel: {
          id: null,
          type: { type: 'fieldOf', card: testRef, field: 'title' },
        },
      }),
      'including fieldOf',
    );
    for (let [label, type] of [
      ['an empty object', {}],
      ['a module with no export name', { module: 'http://test/person' }],
      ['a non-string export name', { module: 'http://test/person', name: 7 }],
      [
        'an ancestorOf wrapping nothing resolvable',
        {
          type: 'ancestorOf',
          card: {},
        },
      ],
      ['an unrecognized ref form', { type: 'siblingOf', card: testRef }],
    ] as const) {
      assert.false(
        isBoxelValueReference({ $boxel: { id: 'http://test/x', type } }),
        `${label} is not a code ref`,
      );
    }
    assert.false(isBoxelValueReference({ title: 'Ada' }), 'plain field data');
    assert.false(isBoxelValueReference(null), 'null');
    assert.false(
      isBoxelValueReference([{ $boxel: { id: null, type: testRef } }]),
      'an array of references is not one',
    );
  });

  test('RP-14.1: the SafeEvent allowlists are disjoint and exclude the members that hand back authority', function (assert) {
    let eventLists = [
      SAFE_EVENT_BOOLEAN_PROPERTIES,
      SAFE_EVENT_NUMBER_PROPERTIES,
      SAFE_EVENT_STRING_PROPERTIES,
      SAFE_EVENT_NULLABLE_STRING_PROPERTIES,
    ];
    let targetLists = [
      SAFE_EVENT_TARGET_BOOLEAN_PROPERTIES,
      SAFE_EVENT_TARGET_NUMBER_PROPERTIES,
      SAFE_EVENT_TARGET_STRING_PROPERTIES,
      SAFE_EVENT_TARGET_SCALAR_PROPERTIES,
    ];

    for (let [label, lists] of [
      ['event', eventLists],
      ['event target', targetLists],
    ] as const) {
      let all = lists.flatMap((list) => [...list]);
      assert.strictEqual(
        new Set(all).size,
        all.length,
        `no ${label} member appears in two type groups, which would give the derived type two answers for it`,
      );
    }

    // A member that hands back a live object, a function, or a route out of
    // the reduced record defeats the reduction, so no allowlist may name one.
    for (let forbidden of [
      'preventDefault',
      'stopPropagation',
      'composedPath',
      'relatedTarget',
      'srcElement',
      'view',
      'path',
      'target',
      'currentTarget',
      'ownerDocument',
      'parentElement',
      'form',
      'labels',
      'files',
    ]) {
      assert.false(
        [...eventLists, ...targetLists].some((list) =>
          (list as readonly string[]).includes(forbidden),
        ),
        `${forbidden} is not allowlisted`,
      );
    }
  });

  test('RP-14.2: the runtime operation names are exactly the ones the protocol declares, and writing is not among them', function (assert) {
    assert.deepEqual(
      [...BOXEL_RUNTIME_OPERATIONS],
      [
        'loadBoxel',
        'createFromSerialized',
        'describeBoxel',
        'getFields',
        'getField',
        'projectInstance',
        'serializeCard',
        'dispose',
      ],
      'a tier that needs another cross-boundary behavior needs a spec change, not an extra operation',
    );

    // Rendering and invoking an action are absent for reasons of kind, not
    // omission: a mountable component is not cloneable and cannot be a member
    // of a tier-neutral interface, and an action belongs to a component
    // instance rather than to the runtime.
    for (let elsewhere of [
      'getRenderSlot',
      'buildRenderRecord',
      'invokeAction',
    ]) {
      assert.false(
        (BOXEL_RUNTIME_OPERATIONS as readonly string[]).includes(elsewhere),
        `${elsewhere} is not a member of the tier-neutral interface`,
      );
    }

    // Mutation is a Host-granted, re-authorized-per-use capability, so it can
    // never appear here as something a tier simply calls.
    for (let mutation of ['set', 'setField', 'patch', 'save', 'delete']) {
      assert.false(
        (BOXEL_RUNTIME_OPERATIONS as readonly string[]).includes(mutation),
        `${mutation} is a capability, not an operation`,
      );
    }

    // createFromSerialized carries why it is materializing, because indexing
    // must fail loudly where an interactive surface degrades to an error
    // card. Collapsing the two lets an indexing failure ride as a rendering
    // failure.
    assert.deepEqual(
      [...MATERIALIZATION_PURPOSES],
      [
        'host-display',
        'code-preview',
        'interactive-edit',
        'command-validation',
        'indexing',
      ],
      'the purposes a runtime must distinguish',
    );
    assert.true(
      (MATERIALIZATION_PURPOSES as readonly string[]).includes('indexing'),
      'indexing is named separately from every interactive purpose',
    );
  });

  test('RP-14.1: a projected error carries its root cause, and a cyclic chain terminates', function (assert) {
    let error = projectedError();
    assert.strictEqual(
      error.cause?.message,
      'total is not a function',
      'the fault under the boundary wrapper crosses, not just the wrapper',
    );
    assert.deepEqual(
      structuredClone(error),
      error,
      'an error crosses as data, never as an Error instance',
    );

    // structuredClone preserves cycles, so a chain that loops back on itself
    // arrives intact over postMessage. An unbounded walk hangs instead of
    // reporting, which is why the bound is a walker and not a constant.
    let looping: { name: string; message: string; cause?: unknown } = {
      name: 'Error',
      message: 'outer',
    };
    looping.cause = looping;
    let projected = projectError(looping);
    let depth = 0;
    for (
      let node: typeof projected | undefined = projected;
      node;
      node = node.cause
    ) {
      depth += 1;
    }
    assert.strictEqual(
      depth,
      PROJECTED_ERROR_MAX_CAUSE_DEPTH,
      'the walk stops at the declared bound rather than following the cycle',
    );

    assert.strictEqual(
      projectError('a thrown string').message,
      'a thrown string',
      'a non-Error throw still projects',
    );
  });

  test("RP-14.1: a projected dataset carries the author's own keys and nothing else", function (assert) {
    // A denylist cannot hold here. Base stamps a card's canonical URL under
    // at least three spellings — data-boxel-card-id, data-test-card, and
    // data-cards-grid-item, the last one added precisely because the
    // data-test- spelling is pruned in production — across sixteen distinct
    // data-* namespaces. The author's own key set is the only thing that
    // separates what they wrote from what the Host stamped around it.
    let onTheElement = {
      boxelCardId: 'http://test/vendors/1',
      testCard: 'http://test/vendors/1',
      cardsGridItem: 'http://test/vendors/1',
      cardTypeDisplayName: 'Invoice',
      cardUrl: 'http://test/vendors/1',
      sku: 'A-17',
      rowIndex: '3',
    };
    let projected = projectDataset(onTheElement, ['sku', 'rowIndex']);
    assert.deepEqual(
      { ...projected },
      { sku: 'A-17', rowIndex: '3' },
      'only what the author declared crosses',
    );
    for (let [key, value] of Object.entries(projected)) {
      assert.false(
        value.includes('/vendors/'),
        `${key} carries no card identity`,
      );
    }

    // An author cannot name a key into existence that the element does not
    // carry, and cannot reach the Host's by declaring it.
    assert.deepEqual(
      { ...projectDataset(onTheElement, ['boxelCardId', 'absent']) },
      { boxelCardId: 'http://test/vendors/1' },
      'the allowlist is an intersection: declaring a key does not conjure one',
    );
    assert.deepEqual(
      { ...projectDataset({}, ['sku']) },
      {},
      'an empty dataset projects empty',
    );
  });

  test('RP-14.3: a record whose protocol version this consumer does not implement is refused', function (assert) {
    let seen: string[] = [];
    assert.throws(
      () =>
        assertUsableExecutionRecord(
          watched(
            description({
              protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION + 1,
            }),
            seen,
          ),
          support,
        ),
      (error: Error) =>
        error instanceof ProtocolRefusal &&
        error.code === 'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
      'refused by name',
    );
    assert.deepEqual(
      seen,
      ['protocolVersion', 'requiredFeatures'],
      'the refusal is decided from the envelope alone, before any member of the record it describes is read',
    );
  });

  test('RP-14.3: an unknown required feature refuses the whole record, naming every one at once', function (assert) {
    let seen: string[] = [];
    let record = watched(
      description({
        requiredFeatures: ['known-feature', 'guides-v2', 'annotations-v1'],
      }),
      seen,
    );

    try {
      assertUsableExecutionRecord(record, {
        protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
        features: new Set(['known-feature']),
      });
      assert.true(false, 'expected a refusal');
    } catch (error) {
      assert.true(error instanceof ProtocolRefusal);
      assert.strictEqual(
        (error as ProtocolRefusal).code,
        'BOXEL_PROTOCOL_FEATURE_UNSUPPORTED',
      );
      for (let feature of ['guides-v2', 'annotations-v1']) {
        assert.true(
          (error as Error).message.includes(feature),
          `the one diagnostic names ${feature}`,
        );
      }
    }

    assert.deepEqual(
      seen,
      ['protocolVersion', 'requiredFeatures'],
      'nothing the record describes was read before it was refused',
    );
  });

  test('RP-14.3: a record every one of whose required features is implemented passes', function (assert) {
    let record = projection({ requiredFeatures: ['query-fields-v1'] });
    assertUsableExecutionRecord(record, {
      protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
      features: new Set(['query-fields-v1', 'guides-v2']),
    });
    assert.strictEqual(
      record.model.title,
      'Ada',
      'the record is left intact for the consumer to read',
    );
  });

  test('RP-14.3: the semantic and transport versions are enforced independently', function (assert) {
    assert.throws(
      () =>
        assertExecutionTransportVersion(BOXEL_EXECUTION_TRANSPORT_VERSION + 1),
      (error: Error) =>
        error instanceof ProtocolRefusal &&
        error.code === 'BOXEL_TRANSPORT_VERSION_UNSUPPORTED',
      'an unimplemented transport version is refused',
    );

    // Neither gate consults the other's number: a record at this consumer's
    // semantic version passes whatever the transport is doing, and a message
    // at this endpoint's transport version passes whatever semantic version
    // the record inside it declares.
    assertExecutionTransportVersion(BOXEL_EXECUTION_TRANSPORT_VERSION);
    assertUsableExecutionRecord(description(), support);
    assert.throws(
      () =>
        assertUsableExecutionRecord(
          description({
            protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION + 1,
          }),
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code ===
        'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
      'a semantic mismatch is a semantic refusal, never a transport one',
    );
  });

  test('RP-14.3: an unrecognized template dependency kind refuses the whole generation', function (assert) {
    let unrecognized = bundle([
      { kind: 'trusted-export', module: '@cardstack/boxel-ui', name: 'Pill' },
      {
        kind: 'homemade-helper',
        name: 'formatMoney',
      } as unknown as TemplateDependency,
      { kind: 'ambient-fetch', name: 'load' } as unknown as TemplateDependency,
    ]);

    try {
      acceptTemplateBundle(unrecognized, support);
      assert.true(false, 'expected a refusal');
    } catch (error) {
      assert.strictEqual(
        (error as ProtocolRefusal).code,
        'BOXEL_TEMPLATE_DEPENDENCY_KIND_UNKNOWN',
      );
      for (let kind of ['homemade-helper', 'ambient-fetch']) {
        assert.true(
          (error as Error).message.includes(kind),
          `the one diagnostic names ${kind}`,
        );
      }
    }

    // The recognized vocabulary passes whole. The authored-component entry
    // names a template the bundle actually carries, since a reference to one
    // it does not is its own refusal.
    let carried = bundle([
      { kind: 'trusted-export', module: '@cardstack/boxel-ui', name: 'Pill' },
      { kind: 'trusted-export', module: '@ember/modifier', name: 'on' },
      { kind: 'authored-component', templateId: 'template-1' },
      // A module-level constant a template interpolates. This is the fall-
      // through of scope classification, so it is the common case, not an
      // edge one: a vocabulary without it refuses the whole generation for
      // `const LABEL = '...'; <template>{{LABEL}}</template>`.
      { kind: 'literal-value', value: 'Ships in 2 days' },
      { kind: 'literal-value', value: { nested: [1, 2, null] } },
    ]);
    acceptTemplateBundle(
      {
        ...carried,
        templates: {
          ...carried.templates,
          'template-1': {
            ...carried.templates['template-0'],
            id: 'template-1',
          },
        },
      },
      support,
    );
    assert.deepEqual(
      [...TEMPLATE_DEPENDENCY_KINDS],
      ['trusted-export', 'authored-component', 'literal-value'],
      'the dependency vocabulary is closed',
    );
  });

  test('RP-14.3: a bundle is refused on its version before its dependencies are inspected', function (assert) {
    let stale = bundle([
      {
        kind: 'homemade-helper',
        name: 'formatMoney',
      } as unknown as TemplateDependency,
    ]);
    stale.protocolVersion = BOXEL_EXECUTION_PROTOCOL_VERSION + 1;

    assert.throws(
      () => acceptTemplateBundle(stale, support),
      (error: Error) =>
        error instanceof ProtocolRefusal &&
        error.code === 'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
      'the version answers first; a record this consumer cannot read is not worth walking',
    );
  });

  test('RP-14.3: an unrecognized effect kind refuses the update, its changed state included', function (assert) {
    let withUnknownEffect = update({
      effects: [
        { kind: 'layout', payload: { heightMode: 'intrinsic' } },
        {
          kind: 'open-window',
          payload: { url: 'http://elsewhere' },
        } as unknown as ComponentUpdate['effects'][number],
      ],
    });

    assert.throws(
      () => acceptComponentUpdate(withUnknownEffect, support),
      (error: Error) =>
        error instanceof ProtocolRefusal &&
        error.code === 'BOXEL_COMPONENT_EFFECT_KIND_UNKNOWN',
      'applying the state and dropping the request would show a half-performed intent',
    );

    acceptComponentUpdate(update(), support);
    assert.deepEqual(
      [...COMPONENT_EFFECT_KINDS],
      ['presentation', 'layout', 'observe', 'view-card', 'patch'],
      'the effect vocabulary is closed',
    );
  });

  test('RP-14.3: a record whose own shape is unreadable is refused by name, not by TypeError', function (assert) {
    // The producer is across a trust boundary, so the record's shape is the
    // first thing in doubt. A consumer catches ProtocolRefusal; anything else
    // escapes it unhandled and takes the last-known-good output with it.
    let malformed: [string, unknown][] = [
      ['a null record', null],
      ['an array', []],
      ['a string', 'BoxelDescription'],
      ['no protocolVersion', { requiredFeatures: [] }],
      [
        'a string protocolVersion',
        { protocolVersion: '1', requiredFeatures: [] },
      ],
      ['a NaN protocolVersion', { protocolVersion: NaN, requiredFeatures: [] }],
      ['no requiredFeatures', { protocolVersion: 1 }],
      [
        'requiredFeatures as a bare string',
        { protocolVersion: 1, requiredFeatures: 'guides-v2' },
      ],
      [
        'a non-string among requiredFeatures',
        { protocolVersion: 1, requiredFeatures: ['ok', 7] },
      ],
    ];
    for (let [label, record] of malformed) {
      assert.throws(
        () =>
          assertUsableExecutionRecord(
            record as unknown as BoxelDescription,
            support,
          ),
        (error: Error) =>
          error instanceof ProtocolRefusal &&
          error.code === 'BOXEL_RECORD_MALFORMED',
        `${label} is refused by name`,
      );
    }
  });

  test('RP-14.3: the version answers before the feature list, so a later version is never judged against this consumer feature set', function (assert) {
    // Both are wrong, and only one answer is right: feature names from a
    // version this consumer does not implement mean nothing measured against
    // the features it does.
    assert.throws(
      () =>
        assertUsableExecutionRecord(
          description({
            protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION + 1,
            requiredFeatures: ['a-feature-from-a-later-version'],
          }),
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code ===
        'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
      'the version refusal wins',
    );
  });

  test('RP-14.3: a component update is gated on its envelope, not only on its effect kinds', function (assert) {
    assert.throws(
      () =>
        acceptComponentUpdate(
          update({ protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION + 1 }),
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code ===
        'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
      'an unreadable version is refused before its effects are inspected',
    );
    assert.throws(
      () =>
        acceptComponentUpdate(
          update({ requiredFeatures: ['an-unbuilt-feature'] }),
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code ===
        'BOXEL_PROTOCOL_FEATURE_UNSUPPORTED',
      'so is an unimplemented required feature',
    );
    assert.throws(
      () =>
        acceptComponentUpdate(
          update({ effects: [null] as unknown as ComponentUpdate['effects'] }),
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
      'and an entry that is not an effect at all',
    );
  });

  test('RP-14.1: a bundle naming a template it does not carry is refused whole', function (assert) {
    // A dangling reference reifies into a component whose scope resolves to
    // nothing at render time — the same failure an unrecognized kind causes,
    // reached by a different route.
    let carried = bundle();
    let dangling: [string, TemplateBundle][] = [
      ['a root that names nothing', { ...carried, root: 'template-absent' }],
      ['an empty bundle', { ...carried, templates: {} }],
      [
        'an authored component that names nothing',
        {
          ...carried,
          templates: {
            'template-0': {
              ...carried.templates['template-0'],
              scope: [{ kind: 'authored-component', templateId: 'template-9' }],
            },
          },
        },
      ],
    ];
    for (let [label, candidate] of dangling) {
      assert.throws(
        () => acceptTemplateBundle(candidate, support),
        (error: Error) =>
          error instanceof ProtocolRefusal &&
          error.code === 'BOXEL_TEMPLATE_BUNDLE_INCOMPLETE',
        `${label} is refused`,
      );
    }

    // A descriptor whose id differs from its map key is NOT dangling. The key
    // is the bundle's reference space and the id is the compiler's, and a
    // class inheriting its template from an ancestor legitimately yields two
    // entries carrying one compiler id.
    acceptTemplateBundle(
      {
        ...carried,
        templates: {
          'template-0': {
            ...carried.templates['template-0'],
            id: 'a-compiler-assigned-id',
          },
        },
      },
      support,
    );
    assert.true(true, 'the two id spaces may differ');
  });

  test('RP-14.3: a version this consumer does not implement is refused in either direction', function (assert) {
    // Both directions matter. An older record is not "compatible enough": the
    // version is a build-identity check, and all forward compatibility is
    // carried by requiredFeatures instead.
    for (let offset of [-1, 1]) {
      assert.throws(
        () =>
          assertUsableExecutionRecord(
            description({
              protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION + offset,
            }),
            support,
          ),
        (error: Error) =>
          (error as ProtocolRefusal).code ===
          'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
        `protocol version ${BOXEL_EXECUTION_PROTOCOL_VERSION + offset} is refused`,
      );
      assert.throws(
        () =>
          assertExecutionTransportVersion(
            BOXEL_EXECUTION_TRANSPORT_VERSION + offset,
          ),
        (error: Error) =>
          (error as ProtocolRefusal).code ===
          'BOXEL_TRANSPORT_VERSION_UNSUPPORTED',
        `transport version ${BOXEL_EXECUTION_TRANSPORT_VERSION + offset} is refused`,
      );
    }
  });

  test('RP-14.3: a bundle reaches a template only through the map own keys', function (assert) {
    // `in` would resolve these against Object.prototype and report a template
    // the bundle does not carry.
    for (let inherited of ['toString', 'constructor', 'hasOwnProperty']) {
      assert.throws(
        () => acceptTemplateBundle({ ...bundle(), root: inherited }, support),
        (error: Error) =>
          (error as ProtocolRefusal).code ===
          'BOXEL_TEMPLATE_BUNDLE_INCOMPLETE',
        `a root of '${inherited}' names no carried template`,
      );
    }
  });

  test('RP-14.3: a refusal repeats a boundary string only in bounded, escaped form', function (assert) {
    // The string that triggers a refusal is chosen by the code being refused,
    // and the refusal is written to a log.
    let hostile = 'x'.repeat(5000);
    try {
      acceptComponentUpdate(
        update({
          effects: [
            { kind: hostile, payload: null },
          ] as unknown as ComponentUpdate['effects'],
        }),
        support,
      );
      assert.true(false, 'expected a refusal');
    } catch (error) {
      assert.true(
        (error as Error).message.length < 500,
        'a megabyte of caged-code output does not reach the log through the diagnostic',
      );
    }

    try {
      acceptTemplateBundle(
        { ...bundle(), root: 'line-one\nWARN forged-line' },
        support,
      );
      assert.true(false, 'expected a refusal');
    } catch (error) {
      assert.false(
        (error as Error).message.includes('\nWARN'),
        'an embedded newline cannot forge a log line',
      );
    }
  });

  test('RP-14.3: a bundle a consumer could not reify is refused before it tries', function (assert) {
    // The kind allowlist establishes almost nothing on its own: what a
    // consumer compiles, iterates, and dereferences has to be checked too.
    let carried = bundle();
    let descriptor = carried.templates['template-0'];
    let unreifiable: [string, unknown][] = [
      [
        'a block that is not a compiled template',
        { ...descriptor, block: { evil: 1 } },
      ],
      [
        'stylesheets as a bare string',
        { ...descriptor, stylesheets: 'style.css' },
      ],
      ['isStrictMode as a string', { ...descriptor, isStrictMode: 'yes' }],
      ['no instance descriptor', { ...descriptor, instance: null }],
      [
        'an instance without a handle',
        { ...descriptor, instance: { ...descriptor.instance, handle: 7 } },
      ],
      [
        'getters that are not names',
        {
          ...descriptor,
          instance: { ...descriptor.instance, getters: [1, 2] },
        },
      ],
    ];
    for (let [label, broken] of unreifiable) {
      assert.throws(
        () =>
          acceptTemplateBundle(
            {
              ...carried,
              templates: { 'template-0': broken },
            } as TemplateBundle,
            support,
          ),
        (error: Error) =>
          (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
        `${label} is refused`,
      );
    }

    let payloadless: [string, unknown][] = [
      [
        'a trusted export with no module',
        { kind: 'trusted-export', name: 'Pill' },
      ],
      [
        'a trusted export with a non-string name',
        { kind: 'trusted-export', module: 'm', name: 7 },
      ],
      [
        'an authored component with no templateId',
        { kind: 'authored-component' },
      ],
    ];
    for (let [label, dependency] of payloadless) {
      assert.throws(
        () =>
          acceptTemplateBundle(
            bundle([dependency as TemplateDependency]),
            support,
          ),
        (error: Error) =>
          (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
        `${label} is refused`,
      );
    }
  });

  test('RP-14.3: a bundle whose container members are the wrong shape is refused', function (assert) {
    let malformed: [string, unknown][] = [
      ['templates that is not an object', { ...bundle(), templates: [] }],
      ['a root that is not a string', { ...bundle(), root: 7 }],
      [
        'a descriptor that is not an object',
        { ...bundle(), templates: { 'template-0': 'nope' } },
      ],
      [
        'a scope that is not an array',
        {
          ...bundle(),
          templates: {
            'template-0': { ...bundle().templates['template-0'], scope: {} },
          },
        },
      ],
    ];
    for (let [label, candidate] of malformed) {
      assert.throws(
        () => acceptTemplateBundle(candidate as TemplateBundle, support),
        (error: Error) =>
          (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
        `${label} is refused`,
      );
    }
    assert.throws(
      () =>
        acceptComponentUpdate(
          update({
            effects: 'view-card' as unknown as ComponentUpdate['effects'],
          }),
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
      'effects that is not an array is refused',
    );
  });

  test('RP-14.1: a refusal is constructible where the intrinsics are hardened', function (assert) {
    // SES lockdown() freezes Error.prototype, and `name` is inherited from it.
    // Assigning rather than defining makes ProtocolRefusal unconstructible in
    // a Compartment — turning every refusal in the module back into the raw
    // TypeError it exists to replace, in the one environment it exists for.
    let descriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name');
    Object.defineProperty(Error.prototype, 'name', {
      value: 'Error',
      writable: false,
      configurable: true,
    });
    try {
      assertUsableExecutionRecord(
        description({ protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION + 1 }),
        support,
      );
      assert.true(false, 'expected a refusal');
    } catch (error) {
      assert.true(
        error instanceof ProtocolRefusal,
        'the refusal survives a non-writable inherited name',
      );
      assert.strictEqual((error as Error).name, 'ProtocolRefusal');
      assert.strictEqual(
        (error as ProtocolRefusal).code,
        'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
      );
    } finally {
      Object.defineProperty(Error.prototype, 'name', descriptor!);
    }
  });

  test('RP-14.1: a code ref carrying more than its own members is not a reference', function (assert) {
    // The exactness the marker promises has to reach inside the ref: a ref
    // that admits extra members lets a whole card ride in `type`.
    assert.false(
      isBoxelValueReference({
        $boxel: {
          id: 'http://test/x',
          type: {
            module: 'http://test/person',
            name: 'Person',
            attributes: { title: 'Ada', notes: 'the entire card' },
          },
        },
      }),
      'an expanded graph inside the ref is refused',
    );
    assert.true(
      isBoxelValueReference({
        $boxel: {
          id: null,
          type: { type: 'fieldOf', card: testRef, field: 'title' },
        },
      }),
      'a well-formed fieldOf still answers true',
    );

    // A predicate whose contract is to answer must not throw instead.
    let nested: unknown = { module: 'http://test/person', name: 'Person' };
    for (let i = 0; i < 5000; i++) {
      nested = { type: 'ancestorOf', card: nested };
    }
    assert.false(
      isBoxelValueReference({ $boxel: { id: null, type: nested } }),
      'a ref nested past any reasonable depth is refused, not a stack overflow',
    );
  });

  test('RP-14.3: a literal value that is not data is refused before a consumer clones it', function (assert) {
    let notData: [string, TemplateDependency][] = [
      ['a function', { kind: 'literal-value', value: () => 'evil' }],
      [
        'a nested function',
        { kind: 'literal-value', value: { a: { b: () => 1 } } },
      ],
      ['a class instance', { kind: 'literal-value', value: new Date() }],
      ['undefined', { kind: 'literal-value', value: undefined }],
    ] as unknown as [string, TemplateDependency][];
    for (let [label, dependency] of notData) {
      assert.throws(
        () => acceptTemplateBundle(bundle([dependency]), support),
        (error: Error) =>
          (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
        `${label} is not a literal value`,
      );
    }

    // Reading the member would invoke the accessor — running far-side code
    // inside the gate, and escaping as its own error rather than a refusal.
    let hostile = { kind: 'literal-value' } as unknown as TemplateDependency;
    Object.defineProperty(hostile, 'value', {
      get() {
        throw new Error('executed inside the gate');
      },
      enumerable: true,
    });
    assert.throws(
      () => acceptTemplateBundle(bundle([hostile]), support),
      (error: Error) =>
        (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
      'an accessor is refused without being read',
    );

    acceptTemplateBundle(
      bundle([
        { kind: 'literal-value', value: { a: [1, 'x', null, false] } },
        { kind: 'literal-value', value: null },
        { kind: 'literal-value', value: false },
      ]),
      support,
    );
    assert.true(true, 'ordinary JSON, null and false all cross');
  });

  test('RP-14.3: an update whose guard members are unusable is refused', function (assert) {
    for (let [label, override] of [
      ['a generation that cannot be compared', { generation: 'nine' }],
      ['a non-finite generation', { generation: NaN }],
      ['changed that is not a record', { changed: 'oops' }],
      ['changed carrying a function', { changed: { total: () => 1 } }],
    ] as [string, Partial<ComponentUpdate>][]) {
      assert.throws(
        () => acceptComponentUpdate(update(override), support),
        (error: Error) =>
          (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
        `${label} is refused`,
      );
    }
  });

  test('RP-14.3: a sparse requiredFeatures is not an array of strings', function (assert) {
    // `some` and `filter` skip holes, so `[, ,]` would pass an
    // every-entry-is-a-string check and be carried as phantom features.
    assert.throws(
      () =>
        assertUsableExecutionRecord(
          description({
            // Built rather than written as `[, ,]`, which eslint refuses on
            // sight — the point is the holes, however they are produced.
            requiredFeatures: new Array(2) as string[],
          }),
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
      'a sparse array is refused',
    );
  });

  test('RP-14.3: a diagnostic is bounded in item count, not only token length', function (assert) {
    // Bounding each token is not enough: the far side chooses how many there
    // are, so fifty thousand short names is the same megabyte by another route.
    try {
      assertUsableExecutionRecord(
        description({
          requiredFeatures: Array.from({ length: 50000 }, (_, i) => `f${i}`),
        }),
        support,
      );
      assert.true(false, 'expected a refusal');
    } catch (error) {
      assert.true(
        (error as Error).message.length < 1000,
        'the refusal names a bounded sample, not every offending item',
      );
    }

    let vast = projectError({
      name: 'Error',
      message: 'M'.repeat(500000),
      stack: 'S'.repeat(500000),
    });
    assert.true(
      vast.message.length <= PROJECTED_ERROR_MAX_TEXT_LENGTH + 1,
      'a projected message is bounded before it reaches error presentation',
    );
    assert.true(
      (vast.stack?.length ?? 0) <= PROJECTED_ERROR_MAX_TEXT_LENGTH + 1,
      'so is its stack',
    );
  });

  test('RP-14.3: a rejected scalar is named by its value, not by its type', function (assert) {
    // describeValue names a value by type when the type is the fault; when the
    // value is the whole complaint, printing "number" says nothing.
    try {
      assertExecutionTransportVersion(BOXEL_EXECUTION_TRANSPORT_VERSION + 98);
      assert.true(false, 'expected a refusal');
    } catch (error) {
      assert.true(
        (error as Error).message.includes(
          String(BOXEL_EXECUTION_TRANSPORT_VERSION + 98),
        ),
        'the diagnostic names the version it was handed',
      );
    }
  });

  test('RP-14.3: a gate hands back what it checked, not the object it was given', function (assert) {
    // Validating in place answers a question about the adversary's object and
    // then hands that same object on, so a Proxy can answer the check one way
    // and the consumer another. What a consumer applies has to be what was
    // checked.
    let reads = 0;
    let shifty = new Proxy(
      { kind: 'trusted-export', module: '@cardstack/boxel-ui', name: 'Pill' },
      {
        get(target, key, receiver) {
          if (key === 'kind') {
            reads += 1;
            return reads > 4 ? 'literal-value' : 'trusted-export';
          }
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          if (key === 'kind') {
            reads += 1;
            return {
              value: reads > 4 ? 'literal-value' : 'trusted-export',
              writable: true,
              enumerable: true,
              configurable: true,
            };
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    ) as unknown as TemplateDependency;

    let accepted = acceptTemplateBundle(bundle([shifty]), support);
    let dependency = accepted.templates['template-0'].scope[0];
    assert.strictEqual(
      dependency.kind,
      'trusted-export',
      'the returned dependency is a plain object whose kind cannot change under the consumer',
    );
    assert.strictEqual(
      Object.getPrototypeOf(dependency),
      Object.prototype,
      'and it is not the proxy the gate was handed',
    );

    // A non-enumerable member is still reachable by whoever holds the object,
    // so a normalized value must not carry one.
    let smuggler: Record<string, unknown> = { visible: 1 };
    Object.defineProperty(smuggler, 'run', {
      value: () => 'reached authored scope',
      enumerable: false,
    });
    assert.throws(
      () =>
        acceptTemplateBundle(
          bundle([
            { kind: 'literal-value', value: smuggler } as TemplateDependency,
          ]),
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
      'a non-enumerable function member is refused',
    );

    let symbolic: Record<string, unknown> = { visible: 1 };
    (symbolic as Record<symbol, unknown>)[Symbol('hidden')] = () => 'reached';
    assert.throws(
      () =>
        acceptTemplateBundle(
          bundle([
            { kind: 'literal-value', value: symbolic } as TemplateDependency,
          ]),
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
      'a symbol-keyed member is refused',
    );
  });

  test('RP-14.3: an accessor anywhere in a record is refused, never invoked', function (assert) {
    // Reading a member through plain property access runs far-side code
    // inside the gate, and a getter that throws escapes as its own error
    // rather than as a refusal.
    let ran = false;
    let hostile = (key: string, host: Record<string, unknown>) => {
      Object.defineProperty(host, key, {
        get() {
          ran = true;
          throw new Error('executed inside the gate');
        },
        enumerable: true,
        configurable: true,
      });
      return host;
    };

    assert.throws(
      () =>
        assertUsableExecutionRecord(
          hostile('protocolVersion', {
            requiredFeatures: [],
          }) as unknown as BoxelDescription,
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
      'an accessor on the envelope is refused',
    );

    let carried = bundle();
    assert.throws(
      () =>
        acceptTemplateBundle(
          {
            ...carried,
            templates: {
              'template-0': hostile('block', {
                ...carried.templates['template-0'],
              }) as unknown as TemplateBundle['templates'][string],
            },
          },
          support,
        ),
      (error: Error) =>
        (error as ProtocolRefusal).code === 'BOXEL_RECORD_MALFORMED',
      'an accessor on a descriptor is refused',
    );

    assert.false(ran, 'no getter was ever invoked');
  });

  test('RP-14.1: projecting a thrown value never throws', function (assert) {
    // Projection IS the clone step for a throw, so nothing has sanitized it
    // first, and authored code can throw anything. A projector that fails
    // leaves a lane with no response on it, which its peer discovers only by
    // timing out.
    let unreadable: Record<string, unknown> = { message: 7 };
    Object.defineProperty(unreadable, 'cause', {
      get() {
        throw new Error('unreadable');
      },
      enumerable: true,
    });
    Object.defineProperty(unreadable, 'toString', {
      value() {
        throw new Error('undescribable');
      },
    });
    let projected = projectError(unreadable);
    assert.strictEqual(typeof projected.message, 'string');
    assert.strictEqual(projected.cause, undefined, 'the bad cause is dropped');

    // A refusal's code is the identity a catalog or a log query keys on, so it
    // needs a member of its own rather than surviving as a message prefix.
    try {
      assertExecutionTransportVersion(BOXEL_EXECUTION_TRANSPORT_VERSION + 1);
      assert.true(false, 'expected a refusal');
    } catch (error) {
      assert.strictEqual(
        projectError(error).code,
        'BOXEL_TRANSPORT_VERSION_UNSUPPORTED',
        'the code crosses as data, not as a prefix to parse',
      );
    }
  });

  test('RP-14.3: a literal value the record type declares legal is not refused', function (assert) {
    // JSONTypes.Value types NaN and the infinities as ordinary numbers, and
    // structuredClone — the contract this module states — carries them. A gate
    // that refused them would reject a type-checking record and take the whole
    // generation with it.
    let accepted = acceptTemplateBundle(
      bundle([
        { kind: 'literal-value', value: NaN },
        { kind: 'literal-value', value: Infinity },
      ]),
      support,
    );
    let values = accepted.templates['template-0'].scope.map((dependency) =>
      dependency.kind === 'literal-value' ? dependency.value : null,
    );
    assert.true(Number.isNaN(values[0] as number), 'NaN crosses');
    assert.strictEqual(values[1], Infinity, 'so does Infinity');
  });

  test('RP-14.3: every code the catalog declares is reachable, and every reachable refusal is declared', function (assert) {
    let thrown = new Set<string>();
    let attempts: (() => void)[] = [
      () =>
        assertUsableExecutionRecord(
          description({
            protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION + 1,
          }),
          support,
        ),
      () =>
        assertUsableExecutionRecord(
          description({ requiredFeatures: ['unbuilt'] }),
          support,
        ),
      () =>
        assertExecutionTransportVersion(BOXEL_EXECUTION_TRANSPORT_VERSION + 1),
      () =>
        acceptTemplateBundle(
          bundle([
            { kind: 'nope', name: 'x' } as unknown as TemplateDependency,
          ]),
          support,
        ),
      () =>
        acceptComponentUpdate(
          update({
            effects: [
              {
                kind: 'nope',
                payload: null,
              } as unknown as ComponentUpdate['effects'][number],
            ],
          }),
          support,
        ),
      () =>
        assertUsableExecutionRecord(
          null as unknown as BoxelDescription,
          support,
        ),
      () =>
        acceptTemplateBundle({ ...bundle(), root: 'template-absent' }, support),
    ];

    for (let attempt of attempts) {
      try {
        attempt();
      } catch (error) {
        thrown.add((error as ProtocolRefusal).code);
      }
    }

    assert.deepEqual(
      [...thrown].sort(),
      [...PROTOCOL_REFUSAL_CODES].sort(),
      'the declared codes and the reachable refusals are the same set',
    );
  });
});
