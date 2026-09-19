import QUnit from 'qunit';
import { basename } from 'node:path';
import {
  CLINICAL_SCENARIOS,
  applyWrites,
  changedOwners,
  clinicalTypeOf,
  expectedOwners,
  expectedSummary,
  expectedBoard,
  expectedCensus,
  generateClinical,
  type ClinicalRecords,
} from './helpers/lattice-clinical-fixture.ts';

const { module, test } = QUnit;
const realmURL = 'https://clinical.example/';

// This layer needs no database, browser or server. It proves the clinical
// use-case catalog is internally consistent before any layer trusts it: the
// generator is deterministic and link-complete, the oracle arithmetic matches
// hand-computed values, and every scenario's hand-stated blast radius equals
// the set of owners whose oracle output actually changes. A catalog that lies
// about its own expectations cannot prove anything about the system.
module(basename(import.meta.filename), function () {
  const { records, ids } = generateClinical({ realmURL });

  test('the smoke workload is deterministic, bounded and link-complete', function (assert) {
    const again = generateClinical({ realmURL });
    assert.deepEqual(
      [...again.records],
      [...records],
      'the same seed reproduces byte-identical records',
    );
    const counts: Record<string, number> = {};
    for (const path of records.keys())
      counts[clinicalTypeOf(records, path)] =
        (counts[clinicalTypeOf(records, path)] ?? 0) + 1;
    assert.deepEqual(
      counts,
      {
        Principal: 8,
        PatientRecord: 3,
        VitalsReading: 7,
        DoseEvent: 12,
        ShiftNote: 6,
        PatientDaySummary: 6,
        WardBoard: 4,
        FacilityCensus: 2,
      },
      'scale 1 fabricates one admitted patient per ward plus one discharged patient, with their day records and owners',
    );
    for (const [path, doc] of records) {
      for (const [name, value] of Object.entries(
        doc.data.relationships ?? {},
      )) {
        const target = value.links.self!.replace(/^\.\.\//, '') + '.json';
        assert.true(
          records.has(target),
          `${path} relationship ${name} points at an existing card`,
        );
      }
    }
    const larger = generateClinical({ realmURL, scale: 3 });
    assert.strictEqual(
      larger.ids.admittedInOrder.length,
      6,
      'scale multiplies admitted patients per ward',
    );
    assert.throws(
      () => generateClinical({ realmURL, scale: 0 }),
      /between 1 and 40/,
      'an unbounded workload is refused',
    );
  });

  test('the oracle reproduces hand-computed clinical values', function (assert) {
    const cardio = ids.admitted.cardiology[0];
    const icu = ids.admitted.icu[0];
    const d0 = ids.dates[0];
    const cardioDay = expectedSummary(
      records,
      ids.summary(cardio, d0) + '.json',
    );
    assert.deepEqual(
      {
        ward: cardioDay.ward,
        admitted: cardioDay.admitted,
        vitalsCount: cardioDay.vitalsCount,
        criticalCount: cardioDay.criticalCount,
        dosesDue: cardioDay.dosesDue,
        dosesGiven: cardioDay.dosesGiven,
        dosesHeld: cardioDay.dosesHeld,
        marComplete: cardioDay.marComplete,
        latestNoteVersion: cardioDay.latestNoteVersion,
        noteSigned: cardioDay.noteSigned,
        rowStatus: cardioDay.rowStatus,
      },
      {
        ward: 'cardiology',
        admitted: true,
        vitalsCount: 2,
        criticalCount: 0,
        dosesDue: 1,
        dosesGiven: 1,
        dosesHeld: 1,
        marComplete: false,
        latestNoteVersion: 2,
        noteSigned: true,
        rowStatus: 'attention',
      },
      'the first cardiology patient-day has two normal readings, one dose due and a signed second note',
    );
    const icuDay = expectedSummary(records, ids.summary(icu, d0) + '.json');
    assert.strictEqual(
      icuDay.criticalCount,
      1,
      'the first ICU reading of the first day is critical',
    );
    assert.true(
      icuDay.lastHeartRate > 0,
      'the latest reading is the 14:00 one',
    );
    assert.strictEqual(
      icuDay.rowStatus,
      'critical',
      'critical outranks a dose due',
    );
    assert.false(
      icuDay.noteSigned,
      'the second admitted patient only has a draft note',
    );

    const discharged = expectedSummary(
      records,
      ids.summary(ids.discharged[0], d0) + '.json',
    );
    assert.deepEqual(
      [
        discharged.admitted,
        discharged.vitalsCount,
        discharged.rowStatus,
        discharged.latestNoteVersion,
      ],
      [false, 1, 'stable', 0],
      'a discharged patient keeps a historical reading, no doses and no notes',
    );

    const board = expectedBoard(records, ids.board('cardiology', d0) + '.json');
    assert.deepEqual(
      {
        censusCount: board.censusCount,
        criticalPatients: board.criticalPatients,
        dueDoses: board.dueDoses,
        unsignedNotes: board.unsignedNotes,
        rows: board.rowLines.length,
      },
      {
        censusCount: 1,
        criticalPatients: 0,
        dueDoses: 1,
        unsignedNotes: 0,
        rows: 1,
      },
      'the cardiology board counts only admitted patients in its rows and signatures',
    );
    assert.true(
      board.rowLines[0].startsWith(`${ids.patientIdOf(cardio)} `),
      'a board row begins with the patient identifier',
    );
    const census = expectedCensus(records, ids.census(d0) + '.json');
    assert.deepEqual(
      census,
      { admittedTotal: 2, criticalTotal: 1, wardsNeedingSignatures: ['icu'] },
      'the facility census sums both wards and names the ward with an unsigned admitted note',
    );
  });

  test('every scenario states its own blast radius correctly', function (assert) {
    const before = expectedOwners(records);
    const seen = new Set<string>();
    for (const scenario of CLINICAL_SCENARIOS) {
      assert.false(seen.has(scenario.key), `${scenario.key} is unique`);
      seen.add(scenario.key);
      const writes = scenario.writes(ids, records);
      assert.true(writes.length > 0, `${scenario.key} writes something`);
      const after = applyWrites(records, writes);
      const changed = changedOwners(before, expectedOwners(after));
      assert.deepEqual(
        changed,
        [...scenario.affected(ids)].sort(),
        `${scenario.key}: the owners whose oracle output changes are exactly the claimed ones`,
      );
      for (const path of scenario.cutoff?.(ids) ?? [])
        assert.false(
          changed.includes(path),
          `${scenario.key}: cutoff owner ${path} is unchanged by the oracle`,
        );
      for (const path of scenario.unaffected?.(ids) ?? [])
        assert.false(
          changed.includes(path),
          `${scenario.key}: unaffected owner ${path} is unchanged by the oracle`,
        );
      for (const path of scenario.paged?.(ids) ?? [])
        assert.true(
          changed.includes(path),
          `${scenario.key}: an owner with a bounded page also changes in the full-membership oracle`,
        );
      // Writes must be applicable in the stated order and idempotent as a set.
      assert.deepEqual(
        [...applyWrites(records, writes)].length,
        [...after].length,
        `${scenario.key}: applying the writes twice from the same base yields the same size`,
      );
    }
  });

  for (const scale of [1, 5, 10]) {
    test(`at scale ${scale}, every claim holds at its point in the sequence`, function (assert) {
      const scaled = generateClinical({ realmURL, scale });
      let current: ClinicalRecords = scaled.records;
      for (const scenario of CLINICAL_SCENARIOS) {
        const next = applyWrites(current, scenario.writes(scaled.ids, current));
        const changed = changedOwners(
          expectedOwners(current),
          expectedOwners(next),
        );
        assert.deepEqual(
          changed,
          [...scenario.affected(scaled.ids)].sort(),
          `${scenario.key} at scale ${scale}: the blast-radius claim holds in sequence`,
        );
        current = next;
      }
    });
  }

  test('scenarios do not overlap in their targets, so they can run in sequence on one realm', function (assert) {
    let current: ClinicalRecords = records;
    const touched = new Map<string, string>();
    for (const scenario of CLINICAL_SCENARIOS) {
      for (const write of scenario.writes(ids, current)) {
        if (write.op === 'POST')
          assert.false(
            current.has(write.path),
            `${scenario.key}: ${write.path} does not already exist when the scenario runs in order`,
          );
        else
          assert.true(
            current.has(write.path),
            `${scenario.key}: ${write.path} still exists when the scenario runs in order`,
          );
        touched.set(write.path, scenario.key);
      }
      // The publication layer asserts each claim against the rolling state,
      // so the claim must hold here too, not only against the initial state.
      const next = applyWrites(current, scenario.writes(ids, current));
      const changed = changedOwners(
        expectedOwners(current),
        expectedOwners(next),
      );
      assert.deepEqual(
        changed,
        [...scenario.affected(ids)].sort(),
        `${scenario.key}: the blast-radius claim holds at its point in the sequence`,
      );
      for (const path of [
        ...(scenario.cutoff?.(ids) ?? []),
        ...(scenario.unaffected?.(ids) ?? []),
      ])
        assert.false(
          changed.includes(path),
          `${scenario.key}: ${path} is unchanged at its point in the sequence`,
        );
      current = next;
    }
    assert.true(
      touched.size >= CLINICAL_SCENARIOS.length,
      'the catalog touches at least one distinct card per scenario',
    );
  });
});
