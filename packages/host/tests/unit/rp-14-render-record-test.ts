import { module, test } from 'qunit';

import {
  checkRecordParity,
  describeParityReport,
  reportsParity,
} from '@cardstack/runtime-common/boxel-execution-conformance';
import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  isProtocolRefusal,
  readBoxelValueReference,
} from '@cardstack/runtime-common/boxel-execution-protocol';
import type { ResolvedField } from '@cardstack/runtime-common/boxel-execution-protocol';
import { rri } from '@cardstack/runtime-common/realm-identifiers';

import type {
  CapturedBoxelInstance,
  CapturedBoxelType,
} from '@cardstack/host/lib/boxel-projection';
import {
  buildBoxelDescription,
  buildBoxelRenderRecord,
  buildInstanceProjection,
  buildResolvedFields,
} from '@cardstack/host/lib/boxel-render-record';

const personRef = { module: rri('http://test/person'), name: 'Person' };
const stringRef = { module: rri('http://test/string'), name: 'StringField' };
const petRef = { module: rri('http://test/pet'), name: 'Pet' };

function capturedType(
  overrides: Partial<CapturedBoxelType> = {},
): CapturedBoxelType {
  return {
    ref: personRef,
    boxelKind: 'card',
    ancestors: [],
    fields: [
      {
        fieldName: 'name',
        type: stringRef,
        kind: 'contains',
        isComputed: false,
        isQueryBacked: false,
      },
    ],
    formats: [
      {
        format: 'isolated',
        provider: { kind: 'trusted-base', ref: personRef },
      },
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

function capturedInstance(
  overrides: Partial<CapturedBoxelInstance> = {},
): CapturedBoxelInstance {
  return {
    id: rri('http://test/Person/1'),
    type: personRef,
    model: { name: 'Hassan' },
    presentation: {
      title: 'Hassan',
      summary: null,
      thumbnailURL: null,
      isThemed: false,
      theme: null,
      themeScope: null,
      themeCss: null,
      cssImports: null,
    },
    ...overrides,
  };
}

function capturedFields(
  overrides: Partial<ResolvedField> = {},
): ResolvedField[] {
  return [
    {
      fieldName: 'name',
      type: stringRef,
      kind: 'contains',
      isComputed: false,
      isQueryBacked: false,
      resolvedConfiguration: null,
      ...overrides,
    },
  ];
}

module('Unit | Boxel render record', function () {
  test('RP-14.1, RP-14.3: both enveloped records carry this build’s protocol version and an empty feature list', function (assert) {
    let record = buildBoxelRenderRecord({
      type: capturedType(),
      instance: capturedInstance(),
      fields: capturedFields(),
      revision: 1,
    });

    for (let [name, enveloped] of [
      ['description', record.description],
      ['projection', record.projection],
    ] as const) {
      assert.strictEqual(
        enveloped.protocolVersion,
        BOXEL_EXECUTION_PROTOCOL_VERSION,
        `the ${name} declares the version this build implements`,
      );
      assert.deepEqual(
        enveloped.requiredFeatures,
        [],
        `the ${name} carries an empty feature list rather than omitting one — a consumer reads it before anything else`,
      );
    }
  });

  test('RP-14.1: a resolved field carries its declaration and its resolved configuration, and never the value', function (assert) {
    let record = buildBoxelRenderRecord({
      type: capturedType(),
      instance: capturedInstance(),
      fields: capturedFields({
        resolvedConfiguration: { placeholder: 'Name' },
      }),
      revision: 1,
    });

    assert.deepEqual(record.fields, [
      {
        fieldName: 'name',
        type: stringRef,
        kind: 'contains',
        isComputed: false,
        isQueryBacked: false,
        resolvedConfiguration: { placeholder: 'Name' },
      },
    ]);
    assert.notOk(
      'value' in record.fields[0],
      'the value lives in the projection’s model; carrying it twice is how the two learn to disagree',
    );
    assert.strictEqual(
      record.projection.model.name,
      'Hassan',
      'and the model is where a consumer reads it',
    );
  });

  test('RP-9.1, RP-7.6: a field states computed and query-backed separately, because writability needs both', function (assert) {
    let fields = buildResolvedFields([
      ...capturedFields({
        fieldName: 'pets',
        type: petRef,
        kind: 'linksToMany',
        isQueryBacked: true,
      }),
      ...capturedFields({
        fieldName: 'greeting',
        isComputed: true,
      }),
    ]);

    let [pets, greeting] = fields;
    assert.deepEqual(
      { isComputed: pets.isComputed, isQueryBacked: pets.isQueryBacked },
      { isComputed: false, isQueryBacked: true },
      'a query-backed relationship is not computed, so isComputed alone cannot report that it is never editable',
    );
    assert.deepEqual(
      {
        isComputed: greeting.isComputed,
        isQueryBacked: greeting.isQueryBacked,
      },
      { isComputed: true, isQueryBacked: false },
      'and a computed field is not query-backed',
    );
  });

  test('RP-14.1: revision orders one instance’s projections against each other', function (assert) {
    let instance = capturedInstance();
    let first = buildInstanceProjection(instance, 1);
    let second = buildInstanceProjection(instance, 2);

    assert.strictEqual(first.revision, 1);
    assert.strictEqual(second.revision, 2);
    assert.deepEqual(
      { ...first, revision: 0 },
      { ...second, revision: 0 },
      'two projections of one unchanged instance differ in nothing but their order',
    );
  });

  test('RP-14.3: a captured member that is not inert data is refused where it was produced, not at the boundary', function (assert) {
    let notData: { candidate: unknown; why: string }[] = [
      {
        candidate: Object.defineProperty({}, 'total', {
          get: () => 3,
          enumerable: true,
        }),
        why: 'an accessor runs again for every consumer that reads it',
      },
      {
        candidate: new (class Money {})(),
        why: 'a class instance is an object, not data',
      },
      { candidate: () => 3, why: 'a function cannot cross a boundary' },
      { candidate: { [Symbol('hidden')]: 1 }, why: 'a symbol-keyed member' },
    ];

    for (let { candidate, why } of notData) {
      assert.throws(
        () =>
          buildInstanceProjection(
            capturedInstance({
              model: { amount: candidate as never },
            }),
            1,
          ),
        (error: unknown) => isProtocolRefusal(error),
        `refused by name: ${why}`,
      );
    }
  });

  test('RP-14.3: a captured value that contains itself is refused rather than walked forever', function (assert) {
    let cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    assert.throws(
      () =>
        buildInstanceProjection(
          capturedInstance({ model: { cycle: cycle as never } }),
          1,
        ),
      (error: unknown) => isProtocolRefusal(error),
    );
  });

  test('RP-14.1: an assembled record is a fresh graph, so mutating the capture afterwards cannot reach it', function (assert) {
    let model = { name: 'Hassan', nested: { city: 'Cairo' } };
    let record = buildBoxelRenderRecord({
      type: capturedType(),
      instance: capturedInstance({ model: model as never }),
      fields: capturedFields(),
      revision: 1,
    });

    model.name = 'someone else';
    model.nested.city = 'somewhere else';

    assert.strictEqual(record.projection.model.name, 'Hassan');
    assert.deepEqual(record.projection.model.nested, { city: 'Cairo' });
    assert.notStrictEqual(
      record.projection.model,
      model,
      'the record owns its own graph rather than aliasing the projection it was built from',
    );
  });

  test('RP-14.1: a link captured as a reference survives assembly as one the protocol reads back', function (assert) {
    let projection = buildInstanceProjection(
      capturedInstance({
        model: {
          pet: { $boxel: { id: rri('http://test/Pet/1'), type: petRef } },
        },
      }),
      1,
    );

    assert.deepEqual(readBoxelValueReference(projection.model.pet), {
      $boxel: { id: rri('http://test/Pet/1'), type: petRef },
    });
  });

  test('RP-14.4: the records this pipeline builds are read as data by the parity harness with direct registered', function (assert) {
    let record = buildBoxelRenderRecord({
      type: capturedType(),
      instance: capturedInstance(),
      fields: capturedFields(),
      revision: 1,
    });

    let report = checkRecordParity({
      fixture: 'a person with one contains field',
      tiers: [
        {
          mode: 'direct',
          description: record.description,
          projection: record.projection,
        },
      ],
      registeredModes: ['direct'],
    });

    assert.true(reportsParity(report), describeParityReport(report));
    assert.strictEqual(
      report.inspections,
      2,
      'both of Direct’s records were read as data, which is the whole check a lone tier gets',
    );
    assert.strictEqual(
      report.comparisons,
      0,
      'and nothing was compared, because Direct is the only registered tier so far',
    );
  });

  test('RP-14.1: a description built for a type carries no instance state', function (assert) {
    let description = buildBoxelDescription(capturedType());

    assert.deepEqual(Object.keys(description).sort(), [
      'ancestors',
      'boxelKind',
      'executionHints',
      'fields',
      'formats',
      'presentation',
      'protocolVersion',
      'ref',
      'requiredFeatures',
    ]);
  });
});
