import { module, test } from 'qunit';

import { formats, rri } from '@cardstack/runtime-common';
import type { Format } from '@cardstack/runtime-common';
import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  BOXEL_RUNTIME_OPERATIONS,
  COMPONENT_EFFECT_KINDS,
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
  assertKnownComponentEffects,
  assertKnownTemplateDependencies,
  assertUsableExecutionRecord,
  childFieldFormatsFor,
  isBoxelValueReference,
} from '@cardstack/runtime-common/boxel-execution-protocol';
import type {
  BoxelDescription,
  ComponentUpdate,
  InstanceProjection,
  ProtocolSupport,
  SafeEvent,
  TemplateBundle,
  TemplateDependency,
} from '@cardstack/runtime-common/boxel-execution-protocol';

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
        fieldType: { module: rri('@cardstack/base/string'), name: 'default' },
        kind: 'contains',
        isComputed: false,
        resolvedConfiguration: { placeholder: 'Name' },
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
function watched<T extends object>(record: T, seen: string[]): T {
  return new Proxy(record, {
    get(target, key, receiver) {
      if (typeof key === 'string') {
        seen.push(key);
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

  test('RP-14.1: every record shape survives structuredClone unchanged', function (assert) {
    for (let [name, record] of [
      ['BoxelDescription', description()],
      ['InstanceProjection', projection()],
      ['TemplateBundle', bundle([{ kind: 'block', name: 'default' }])],
      ['ComponentUpdate', update()],
      ['SafeEvent', safeEvent()],
    ] as const) {
      assert.deepEqual(
        structuredClone(record),
        record,
        `${name} crosses a boundary intact`,
      );
    }
  });

  test('RP-14.1: a projected link is exactly {$boxel: {id, type}} and nothing more', function (assert) {
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
          model: { title: 'Ada' },
        },
      }),
      'the target embedded inside the marker',
    );
    assert.false(
      isBoxelValueReference({ $boxel: { id: 'http://test/x' } }),
      'no type to resolve against',
    );
    assert.false(isBoxelValueReference({ title: 'Ada' }), 'plain field data');
    assert.false(isBoxelValueReference(null), 'null');
    assert.false(
      isBoxelValueReference([{ $boxel: { id: null, type: testRef } }]),
      'an array of references is not one',
    );
  });

  test('RP-14.1: the SafeEvent allowlists are disjoint and name nothing that hands back authority', function (assert) {
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

  test('RP-14.2: the runtime operation set is closed, and writing is not one of them', function (assert) {
    assert.deepEqual(
      [...BOXEL_RUNTIME_OPERATIONS],
      [
        'loadBoxel',
        'describeBoxel',
        'createFromSerialized',
        'getFields',
        'getField',
        'getRenderSlot',
        'invokeAction',
        'serializeCard',
        'dispose',
      ],
      'a tier that needs more than these needs a spec change, not an extra operation',
    );

    // Mutation is a Host-granted, re-authorized-per-use capability, so it can
    // never appear here as something a tier simply calls.
    for (let mutation of ['set', 'setField', 'patch', 'save', 'delete']) {
      assert.false(
        (BOXEL_RUNTIME_OPERATIONS as readonly string[]).includes(mutation),
        `${mutation} is a capability, not an operation`,
      );
    }
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
    assertUsableExecutionRecord(
      projection({ requiredFeatures: ['query-fields-v1'] }),
      {
        protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
        features: new Set(['query-fields-v1', 'guides-v2']),
      },
    );
    assert.true(true, 'no refusal');
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

    // An endpoint speaking a later transport accepts it while the records it
    // carries stay on this consumer's semantic version, and vice versa: a
    // record at the current semantic version passes its gate no matter what
    // the transport underneath it is doing.
    assertExecutionTransportVersion(
      BOXEL_EXECUTION_TRANSPORT_VERSION + 1,
      BOXEL_EXECUTION_TRANSPORT_VERSION + 1,
    );
    assertUsableExecutionRecord(description(), support);
    assert.true(true, 'neither check consults the other');
  });

  test('RP-14.3: an unrecognized template dependency kind refuses the whole generation', function (assert) {
    let unrecognized = bundle([
      {
        kind: 'trusted-component',
        module: '@cardstack/boxel-ui',
        name: 'Pill',
      },
      {
        kind: 'homemade-helper',
        name: 'formatMoney',
      } as unknown as TemplateDependency,
      { kind: 'ambient-fetch', name: 'load' } as unknown as TemplateDependency,
    ]);

    try {
      assertKnownTemplateDependencies(unrecognized, support);
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

    // The recognized vocabulary passes whole.
    assertKnownTemplateDependencies(
      bundle([
        {
          kind: 'trusted-component',
          module: '@cardstack/boxel-ui',
          name: 'Pill',
        },
        { kind: 'trusted-helper', module: '@cardstack/base', name: 'cn' },
        { kind: 'safe-modifier', module: '@ember/modifier', name: 'on' },
        { kind: 'authored-component', template: 'template-1' },
        { kind: 'block', name: 'default' },
      ]),
      support,
    );
    assert.deepEqual(
      [...TEMPLATE_DEPENDENCY_KINDS],
      [
        'trusted-component',
        'authored-component',
        'trusted-helper',
        'safe-modifier',
        'block',
      ],
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
      () => assertKnownTemplateDependencies(stale, support),
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
      () => assertKnownComponentEffects(withUnknownEffect, support),
      (error: Error) =>
        error instanceof ProtocolRefusal &&
        error.code === 'BOXEL_COMPONENT_EFFECT_KIND_UNKNOWN',
      'applying the state and dropping the request would show a half-performed intent',
    );

    assertKnownComponentEffects(update(), support);
    assert.deepEqual(
      [...COMPONENT_EFFECT_KINDS],
      ['presentation', 'layout', 'observe', 'view-card', 'patch'],
      'the effect vocabulary is closed',
    );
  });

  test('RP-14.3: every refusal a consumer can hit has a name in the catalog', function (assert) {
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
        assertKnownTemplateDependencies(
          bundle([
            { kind: 'nope', name: 'x' } as unknown as TemplateDependency,
          ]),
          support,
        ),
      () =>
        assertKnownComponentEffects(
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
