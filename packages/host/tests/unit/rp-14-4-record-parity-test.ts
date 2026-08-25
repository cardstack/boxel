import { module, test } from 'qunit';

import {
  PARITY_RECORD_KINDS,
  PARITY_REFERENCE_MODE,
  REPORTED_DIVERGENCE_LIMIT,
  TIER_SPECIFIC_RECORD_PATHS,
  checkRecordParity,
  describeParityReport,
  describeRecordDiff,
  diffRecords,
  recordsAgree,
  reportsParity,
} from '@cardstack/runtime-common/boxel-execution-conformance';
import type {
  ParityFinding,
  ParityReport,
  RecordDiff,
  RecordDivergence,
  TierRecords,
} from '@cardstack/runtime-common/boxel-execution-conformance';
import { BOXEL_EXECUTION_PROTOCOL_VERSION } from '@cardstack/runtime-common/boxel-execution-protocol';
import type {
  BoxelDescription,
  BoxelExecutionMode,
  InstanceProjection,
} from '@cardstack/runtime-common/boxel-execution-protocol';
import { rri } from '@cardstack/runtime-common/realm-identifiers';

const personRef = { module: rri('http://test/person'), name: 'Person' };
const stringRef = { module: rri('@cardstack/base/string'), name: 'default' };
const cardDefRef = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };

function description(
  overrides: Partial<BoxelDescription> = {},
): BoxelDescription {
  return {
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    requiredFeatures: [],
    ref: personRef,
    boxelKind: 'card',
    ancestors: [cardDefRef],
    fields: [
      {
        fieldName: 'title',
        type: stringRef,
        kind: 'contains',
        isComputed: false,
      },
      {
        fieldName: 'vendor',
        type: personRef,
        kind: 'linksTo',
        isComputed: false,
      },
    ],
    formats: [
      { format: 'isolated', provider: { kind: 'authored', ref: personRef } },
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
    type: personRef,
    revision: 3,
    model: {
      title: 'Ada',
      vendor: { $boxel: { id: 'http://test/vendors/1', type: personRef } },
    },
    presentation: {
      title: 'Ada',
      summary: null,
      thumbnailURL: null,
      isThemed: true,
      theme: { $boxel: { id: rri('http://test/themes/1'), type: personRef } },
      themeScope: 'http://test/themes/1-9f2c1a',
      themeCss: '--boxel-accent: rebeccapurple;',
      cssImports: ['https://fonts.example/inter.css'],
    },
    ...overrides,
  };
}

/**
 * A description with whatever a producer actually sent in place of a member,
 * including the things `Cloneable` forbids and `any` lets through anyway.
 */
function descriptionWith(overrides: Record<string, unknown>): unknown {
  return { ...description(), ...overrides };
}

/**
 * A projection whose model is whatever a producer actually sent, including the
 * things `Cloneable` forbids and `any` lets through anyway.
 */
function projectionWithModel(model: Record<string, unknown>): unknown {
  return { ...projection(), model };
}

function tier(
  mode: BoxelExecutionMode,
  overrides: Partial<Omit<TierRecords, 'mode'>> = {},
): TierRecords {
  return {
    mode,
    description: description(),
    projection: projection(),
    ...overrides,
  };
}

function divergenceAt(
  diff: RecordDiff,
  path: string,
): RecordDivergence | undefined {
  return diff.divergences.find((divergence) => divergence.path === path);
}

function findingsOfKind<Kind extends ParityFinding['kind']>(
  report: ParityReport,
  kind: Kind,
): Extract<ParityFinding, { kind: Kind }>[] {
  return report.findings.filter(
    (finding): finding is Extract<ParityFinding, { kind: Kind }> =>
      finding.kind === kind,
  );
}

module('Unit | rendering protocol | cross-tier record parity', function () {
  test('RP-14.4: two tiers that built the same records from one input agree', function (assert) {
    let diff = diffRecords(description(), structuredClone(description()));
    assert.true(recordsAgree(diff), describeRecordDiff(diff));
    assert.strictEqual(describeRecordDiff(diff), 'the records agree');
    let projectionDiff = diffRecords(
      projection(),
      structuredClone(projection()),
    );
    assert.true(
      recordsAgree(projectionDiff),
      describeRecordDiff(projectionDiff),
    );
  });

  test('RP-14.4: member order is not part of a record', function (assert) {
    let reference = description();
    // The same members, assigned in the opposite order — which is what two
    // producers building one record through different code produce.
    let reordered: Record<string, unknown> = {};
    for (let name of Object.keys(reference).reverse()) {
      reordered[name] = (reference as Record<string, unknown>)[name];
    }
    let diff = diffRecords(reference, reordered);
    assert.true(recordsAgree(diff), describeRecordDiff(diff));
  });

  test('RP-14.4: the report reads the same whichever producer laid its keys out first', function (assert) {
    // Reported in sorted member order rather than in the order either producer
    // happened to write. Following one side's key order makes the same pair of
    // records produce a different report depending on which one is the
    // reference, which is not a thing a CI log should have to explain.
    let diff = diffRecords(
      projectionWithModel({ zeta: 1, alpha: 2 }),
      projectionWithModel({ zeta: 9, alpha: 9 }),
    );
    assert.deepEqual(
      diff.divergences.map((divergence) => divergence.path),
      ['model.alpha', 'model.zeta'],
    );
  });

  test('RP-14.4: element order is part of a record', function (assert) {
    let reference = description();
    let swapped = description({
      fields: [reference.fields[1], reference.fields[0]],
    });
    let diff = diffRecords(reference, swapped);
    assert.strictEqual(
      divergenceAt(diff, 'fields[0].fieldName')?.reference,
      '"title"',
    );
    assert.strictEqual(
      divergenceAt(diff, 'fields[1].fieldName')?.candidate,
      '"title"',
    );
  });

  test('RP-14.4: a scalar divergence names the path that reaches it', function (assert) {
    let diff = diffRecords(
      description(),
      description({
        presentation: {
          displayName: 'Human',
          headerColor: null,
          prefersWideFormat: false,
        },
      }),
    );
    assert.strictEqual(diff.divergences.length, 1);
    assert.deepEqual(diff.divergences[0], {
      path: 'presentation.displayName',
      reason: 'value',
      reference: '"Person"',
      candidate: '"Human"',
    });
  });

  test('RP-14.4: a divergence inside an array names the element it is in', function (assert) {
    let reference = description();
    let candidate = description({
      fields: [
        { ...reference.fields[0], kind: 'containsMany' },
        reference.fields[1],
      ],
    });
    let diff = diffRecords(reference, candidate);
    assert.strictEqual(diff.divergences.length, 1);
    assert.strictEqual(diff.divergences[0].path, 'fields[0].kind');
    assert.strictEqual(diff.divergences[0].reason, 'value');
  });

  test('RP-14.4: an absent member and a member whose value is undefined are different', function (assert) {
    let absent = diffRecords(
      projectionWithModel({ title: 'Ada', note: undefined }),
      projectionWithModel({ title: 'Ada' }),
    );
    assert.strictEqual(divergenceAt(absent, 'model.note')?.reason, 'absent');
    assert.strictEqual(
      divergenceAt(absent, 'model.note')?.reference,
      'undefined',
    );
    assert.strictEqual(divergenceAt(absent, 'model.note')?.candidate, 'absent');

    let nulled = diffRecords(
      projectionWithModel({ note: undefined }),
      projectionWithModel({ note: null }),
    );
    assert.strictEqual(divergenceAt(nulled, 'model.note')?.reason, 'value');
    assert.strictEqual(divergenceAt(nulled, 'model.note')?.candidate, 'null');
  });

  test('RP-14.4: -0 and 0 are different values, and a report that renders both as 0 would hide it', function (assert) {
    let diff = diffRecords(
      projectionWithModel({ balance: 0 }),
      projectionWithModel({ balance: -0 }),
    );
    assert.strictEqual(divergenceAt(diff, 'model.balance')?.reason, 'value');
    assert.strictEqual(divergenceAt(diff, 'model.balance')?.reference, '0');
    assert.strictEqual(divergenceAt(diff, 'model.balance')?.candidate, '-0');
  });

  test('RP-14.4: NaN on both sides is agreement, and a report names it', function (assert) {
    let agree = diffRecords(
      projectionWithModel({ total: NaN }),
      projectionWithModel({ total: NaN }),
    );
    assert.true(recordsAgree(agree), describeRecordDiff(agree));

    let diverge = diffRecords(
      projectionWithModel({ total: NaN }),
      projectionWithModel({ total: null }),
    );
    assert.strictEqual(divergenceAt(diverge, 'model.total')?.reference, 'NaN');
  });

  test('RP-14.4: an array of a different length reports the lengths', function (assert) {
    let reference = description();
    let diff = diffRecords(
      reference,
      description({ fields: [reference.fields[0]] }),
    );
    let divergence = divergenceAt(diff, 'fields');
    assert.strictEqual(divergence?.reason, 'length');
    assert.strictEqual(divergence?.reference, '2');
    assert.strictEqual(divergence?.candidate, '1');
    // The elements the two share are still compared, and they still agree, so
    // the length is the only thing reported.
    assert.strictEqual(diff.divergences.length, 1);
  });

  test('RP-14.4: a container where the other side has a scalar is a shape divergence', function (assert) {
    let diff = diffRecords(
      description(),
      descriptionWith({ ancestors: 'CardDef' }),
    );
    assert.strictEqual(divergenceAt(diff, 'ancestors')?.reason, 'shape');
  });

  test('RP-14.4: a tier that expanded a link where the reference carried a reference diverges', function (assert) {
    // The projection is one instance deep: a linked value crosses as
    // `{$boxel:{id,type}}` and never as the linked card's own data (RP-14.1).
    // A tier that walked the graph instead disagrees with Direct here.
    let diff = diffRecords(
      projection(),
      projectionWithModel({
        title: 'Ada',
        vendor: { id: 'http://test/vendors/1', title: 'Analytical Engines' },
      }),
    );
    assert.strictEqual(
      divergenceAt(diff, 'model.vendor.$boxel')?.reason,
      'absent',
    );
    assert.strictEqual(divergenceAt(diff, 'model.vendor.id')?.reason, 'absent');
    assert.strictEqual(
      divergenceAt(diff, 'model.vendor.title')?.reason,
      'absent',
    );
  });

  test('RP-14.4: a divergence at the record itself is reported at the root', function (assert) {
    let diff = diffRecords(description(), 'a description');
    assert.strictEqual(diff.divergences.length, 1);
    assert.strictEqual(diff.divergences[0].path, '');
    assert.strictEqual(diff.divergences[0].reason, 'shape');
    assert.true(describeRecordDiff(diff).startsWith('(the record)'));
  });

  test('RP-14.4: sharing on one side and duplication on the other is not a divergence', function (assert) {
    let shared: BoxelDescription['formats'][number] = {
      format: 'isolated',
      provider: { kind: 'authored', ref: personRef },
    };
    let reference = description({ formats: [shared, shared] });
    let candidate = description({
      formats: [structuredClone(shared), structuredClone(shared)],
    });
    let diff = diffRecords(reference, candidate);
    assert.true(recordsAgree(diff), describeRecordDiff(diff));
  });

  test('RP-14.4: a subgraph two records share is compared once, not once per path', function (assert) {
    // Forty levels of a node with two parents is forty values and 2^40 paths.
    // A diff that walks paths never answers on a record the boundary accepts.
    let deep: unknown = { leaf: true };
    for (let level = 0; level < 40; level++) {
      deep = { left: deep, right: deep };
    }
    let diff = diffRecords(deep, structuredClone(deep));
    assert.true(recordsAgree(diff), describeRecordDiff(diff));
  });

  test('RP-14.4: a record carrying an accessor is a fault naming the member, not a divergence', function (assert) {
    let live: Record<string, unknown> = {};
    Object.defineProperty(live, 'title', {
      get: () => 'Ada',
      enumerable: true,
      configurable: true,
    });
    let diff = diffRecords(projectionWithModel(live), projection());
    assert.strictEqual(diff.faults.length, 1);
    assert.strictEqual(diff.faults[0].side, 'reference');
    assert.strictEqual(diff.faults[0].code, 'BOXEL_RECORD_MALFORMED');
    assert.true(diff.faults[0].message.includes('"title" is an accessor'));
    assert.true(
      describeRecordDiff(diff).startsWith('reference is not a record:'),
      describeRecordDiff(diff),
    );
    // Nothing is compared against a value that is not a record: reporting a
    // divergence at every path would say nothing the fault has not.
    assert.strictEqual(diff.divergences.length, 0);
    assert.false(recordsAgree(diff));
  });

  test('RP-14.4: a record carrying a function is a fault', function (assert) {
    let diff = diffRecords(
      projection(),
      projectionWithModel({ recompute: () => 'Ada' }),
    );
    assert.strictEqual(diff.faults.length, 1);
    assert.strictEqual(diff.faults[0].side, 'candidate');
    assert.true(diff.faults[0].message.includes('not data: function'));
  });

  test('RP-14.4: a record whose member has a prototype of its own is a fault', function (assert) {
    class LiveModel {
      title = 'Ada';
    }
    let diff = diffRecords(
      projection(),
      projectionWithModel({ nested: new LiveModel() }),
    );
    assert.strictEqual(diff.faults.length, 1);
    assert.true(
      diff.faults[0].message.includes('a prototype of its own'),
      diff.faults[0].message,
    );
  });

  test('RP-14.4: a symbol-keyed member is a fault', function (assert) {
    let diff = diffRecords(
      projection(),
      projectionWithModel({ nested: { title: 'Ada', [Symbol('hidden')]: 1 } }),
    );
    assert.strictEqual(diff.faults.length, 1);
    assert.true(
      diff.faults[0].message.includes('symbol-keyed'),
      diff.faults[0].message,
    );
  });

  test('RP-14.4: a record that contains itself is a fault rather than a harness that never answers', function (assert) {
    let cyclic: Record<string, unknown> = { title: 'Ada' };
    cyclic.self = cyclic;
    let diff = diffRecords(projectionWithModel(cyclic), projection());
    assert.strictEqual(diff.faults.length, 1);
    assert.true(
      diff.faults[0].message.includes('contains itself'),
      diff.faults[0].message,
    );
  });

  test('RP-14.4: a value that throws from its own trap leaves the diff as a fault', function (assert) {
    let hostile = new Proxy({} as Record<string, unknown>, {
      ownKeys: () => ['title'],
      getOwnPropertyDescriptor: () => {
        throw new Error('trap');
      },
    });
    let diff = diffRecords(
      projection(),
      projectionWithModel({ nested: hostile }),
    );
    assert.strictEqual(diff.faults.length, 1);
    assert.strictEqual(diff.faults[0].code, 'BOXEL_RECORD_MALFORMED');
    assert.true(
      diff.faults[0].message.includes('raised an error'),
      diff.faults[0].message,
    );
  });

  test('RP-14.4: the report is bounded in count and states the number it found', function (assert) {
    let reference: Record<string, unknown> = {};
    let candidate: Record<string, unknown> = {};
    let divergent = REPORTED_DIVERGENCE_LIMIT + 15;
    for (let index = 0; index < divergent; index++) {
      reference[`field${index}`] = 'reference';
      candidate[`field${index}`] = 'candidate';
    }
    let diff = diffRecords(
      projectionWithModel(reference),
      projectionWithModel(candidate),
    );
    assert.strictEqual(diff.divergences.length, REPORTED_DIVERGENCE_LIMIT);
    // The count it found, not the count it printed: a tier developer told they
    // have twenty-five when they have forty fixes twenty-five and re-runs.
    assert.strictEqual(diff.withheld, divergent - REPORTED_DIVERGENCE_LIMIT);
    assert.true(
      describeRecordDiff(diff).includes(
        `and ${divergent - REPORTED_DIVERGENCE_LIMIT} more`,
      ),
    );
  });

  test('RP-14.4: a divergent value is bounded in size', function (assert) {
    let diff = diffRecords(
      projectionWithModel({ body: 'a'.repeat(5000) }),
      projectionWithModel({ body: 'b'.repeat(5000) }),
    );
    let rendered = divergenceAt(diff, 'model.body')?.reference ?? '';
    assert.true(
      rendered.length < 200,
      `rendered ${rendered.length} characters`,
    );
    assert.true(rendered.endsWith('…'));
  });

  test('RP-14.4: an exempt path is not compared, and neither is anything under it', function (assert) {
    let reference = projection();
    let candidate = projection({
      presentation: { ...reference.presentation, themeScope: 'other-scope' },
    });
    let compared = diffRecords(reference, candidate);
    assert.strictEqual(compared.divergences.length, 1);

    let exempted = diffRecords(reference, candidate, {
      exemptPaths: ['presentation'],
    });
    assert.true(recordsAgree(exempted), describeRecordDiff(exempted));
  });

  test('RP-14.4: an exemption names a member of the record shape, not one element position', function (assert) {
    let reference = description();
    let candidate = description({
      fields: [
        { ...reference.fields[0], isComputed: true },
        { ...reference.fields[1], isComputed: true },
      ],
    });
    let diff = diffRecords(reference, candidate, {
      exemptPaths: ['fields[].isComputed'],
    });
    assert.true(recordsAgree(diff), describeRecordDiff(diff));
    // The exemption is that member and no other.
    let neighbour = diffRecords(
      reference,
      description({
        fields: [
          { ...reference.fields[0], kind: 'containsMany' },
          reference.fields[1],
        ],
      }),
      { exemptPaths: ['fields[].isComputed'] },
    );
    assert.strictEqual(neighbour.divergences.length, 1);
  });

  test('RP-14.4: the spec declares no tier-specific record paths, so the diff is total', function (assert) {
    // RP-14.4's "modulo fields this spec explicitly declares tier-specific
    // (currently: none)". An entry appearing here without a statement declaring
    // it means a member stopped being compared and nothing said so.
    assert.deepEqual([...TIER_SPECIFIC_RECORD_PATHS], []);
  });

  test('RP-14.4: one tier is still held to its records being data, with nothing to compare', function (assert) {
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [tier(PARITY_REFERENCE_MODE)],
      registeredModes: [PARITY_REFERENCE_MODE],
    });
    assert.true(reportsParity(report), describeParityReport(report));
    assert.strictEqual(report.comparisons, 0);
    assert.strictEqual(report.inspections, PARITY_RECORD_KINDS.length);
    // The coverage is in the message whether or not anything failed, so a green
    // run cannot read as "the tiers agree" when it means "there was one tier".
    assert.true(
      describeParityReport(report).includes('0 record comparison(s)'),
      describeParityReport(report),
    );
  });

  test('RP-14.4: a lone tier answering with something that is not a record still fails', function (assert) {
    let live: Record<string, unknown> = {};
    Object.defineProperty(live, 'title', {
      get: () => 'Ada',
      enumerable: true,
      configurable: true,
    });
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [
        tier(PARITY_REFERENCE_MODE, { projection: projectionWithModel(live) }),
      ],
      registeredModes: [PARITY_REFERENCE_MODE],
    });
    assert.false(reportsParity(report));
    let faults = findingsOfKind(report, 'fault');
    assert.strictEqual(faults.length, 1);
    assert.strictEqual(faults[0].mode, PARITY_REFERENCE_MODE);
    assert.strictEqual(faults[0].record, 'projection');
  });

  test('RP-14.4: a candidate tier diverging from Direct is attributed to that tier and record', function (assert) {
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [
        tier('direct'),
        tier('capsule', { projection: projection({ revision: 4 }) }),
      ],
      registeredModes: ['direct', 'capsule'],
    });
    assert.false(reportsParity(report));
    let divergences = findingsOfKind(report, 'divergence');
    assert.strictEqual(divergences.length, 1);
    assert.strictEqual(divergences[0].mode, 'capsule');
    assert.strictEqual(divergences[0].record, 'projection');
    assert.strictEqual(divergences[0].divergence.path, 'revision');
    assert.true(
      describeParityReport(report).includes('reference=3 capsule=4'),
      describeParityReport(report),
    );
  });

  test('RP-14.4: three tiers agreeing on both records report parity across every comparison', function (assert) {
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [tier('direct'), tier('capsule'), tier('sandbox')],
      registeredModes: ['direct', 'capsule', 'sandbox'],
    });
    assert.true(reportsParity(report), describeParityReport(report));
    assert.deepEqual(report.comparedModes, ['capsule', 'sandbox']);
    assert.strictEqual(report.comparisons, 2 * PARITY_RECORD_KINDS.length);
    assert.strictEqual(report.inspections, 3 * PARITY_RECORD_KINDS.length);
  });

  test('RP-14.4: tiers are compared in tier order however the caller listed them', function (assert) {
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [tier('sandbox'), tier('capsule'), tier('direct')],
      registeredModes: ['direct', 'capsule', 'sandbox'],
    });
    assert.deepEqual(report.comparedModes, ['capsule', 'sandbox']);
  });

  test('RP-14.4: no reference tier is a finding, not a comparison between candidates', function (assert) {
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [tier('capsule'), tier('sandbox')],
      registeredModes: ['capsule', 'sandbox'],
    });
    assert.false(reportsParity(report));
    assert.strictEqual(findingsOfKind(report, 'reference-missing').length, 1);
    assert.strictEqual(report.comparisons, 0);
    // The records are still read as data, so a malformed one is not excused by
    // the missing reference.
    assert.strictEqual(report.inspections, 2 * PARITY_RECORD_KINDS.length);
  });

  test('RP-14.4: two tiers claiming one mode is a finding, because one of them went unchecked', function (assert) {
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [
        tier('direct'),
        tier('capsule'),
        tier('capsule', { projection: projection({ revision: 9 }) }),
      ],
      registeredModes: ['direct', 'capsule'],
    });
    assert.false(reportsParity(report));
    let repeated = findingsOfKind(report, 'mode-repeated');
    assert.strictEqual(repeated.length, 1);
    assert.strictEqual(repeated[0].mode, 'capsule');
  });

  test('RP-14.4: a tier the harness was not told about is a finding', function (assert) {
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [tier('direct'), tier('sandbox')],
      registeredModes: ['direct'],
    });
    assert.false(reportsParity(report));
    let unregistered = findingsOfKind(report, 'mode-unregistered');
    assert.strictEqual(unregistered.length, 1);
    assert.strictEqual(unregistered[0].mode, 'sandbox');
  });

  test('RP-14.4: a registered tier that produced no records is a finding, not a silent pass', function (assert) {
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [tier('direct')],
      registeredModes: ['direct', 'capsule'],
    });
    assert.false(reportsParity(report));
    let absent = findingsOfKind(report, 'mode-absent');
    assert.strictEqual(absent.length, 1);
    assert.strictEqual(absent[0].mode, 'capsule');
  });

  test('RP-14.4: the harness honors the declared tier-specific paths by default', function (assert) {
    let reference = projection();
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [
        tier('direct'),
        tier('capsule', {
          projection: projection({
            presentation: { ...reference.presentation, themeScope: 'other' },
          }),
        }),
      ],
      registeredModes: ['direct', 'capsule'],
      exemptPaths: ['presentation.themeScope'],
    });
    assert.true(reportsParity(report), describeParityReport(report));
    // Without the exemption the same pair diverges, so the exemption is what
    // suppressed it rather than the records happening to agree.
    let unexempted = checkRecordParity({
      fixture: 'person/1',
      tiers: [
        tier('direct'),
        tier('capsule', {
          projection: projection({
            presentation: { ...reference.presentation, themeScope: 'other' },
          }),
        }),
      ],
      registeredModes: ['direct', 'capsule'],
    });
    assert.strictEqual(findingsOfKind(unexempted, 'divergence').length, 1);
  });

  test('RP-14.4: a divergence past the report limit is carried into the parity report', function (assert) {
    let reference: Record<string, unknown> = {};
    let candidate: Record<string, unknown> = {};
    for (let index = 0; index < REPORTED_DIVERGENCE_LIMIT + 4; index++) {
      reference[`field${index}`] = 'reference';
      candidate[`field${index}`] = 'candidate';
    }
    let report = checkRecordParity({
      fixture: 'person/1',
      tiers: [
        tier('direct', { projection: projectionWithModel(reference) }),
        tier('capsule', { projection: projectionWithModel(candidate) }),
      ],
      registeredModes: ['direct', 'capsule'],
    });
    let withheld = findingsOfKind(report, 'withheld');
    assert.strictEqual(withheld.length, 1);
    assert.strictEqual(withheld[0].count, 4);
    assert.strictEqual(withheld[0].mode, 'capsule');
  });
});
