import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  createPolicyMediationRuntime,
  policyScenarios,
} from '../../examples/policy-mediation-examples.js';

const runtime = createPolicyMediationRuntime();
const materializedRows = runtime.materializeCommonViews();
strictEqual(materializedRows > 0, true, 'common audience views must materialize');

for (const scenario of policyScenarios) {
  const result = runtime.runScenario(scenario, scenario.defaultStrategy);
  strictEqual(result.decision, scenario.expectedDecision, scenario.id);
  strictEqual(result.trace.length > 0, true, `${scenario.id} must retain a decision trace`);
  strictEqual(result.programs.length > 0, true, `${scenario.id} must report its prepared programs`);
}

for (const scenarioId of [
  'anonymous-public-card',
  'student-member-search',
  'faculty-advising-card',
  'directory-projection',
]) {
  const scenario = policyScenarios.find((candidate) => candidate.id === scenarioId)!;
  const onDemand = runtime.runScenario(scenario, 'on-demand');
  const materialized = runtime.runScenario(scenario, 'materialized');
  deepStrictEqual(
    materialized.output,
    onDemand.output,
    `${scenarioId} must have on-demand/materialized parity`,
  );
}

const publicRead = runtime.runScenario(
  policyScenarios.find((scenario) => scenario.id === 'anonymous-public-card')!,
  'materialized',
);
strictEqual(publicRead.cacheHit, true, 'public card should hit its audience view');
deepStrictEqual(
  publicRead.redactedFields.sort(),
  [
    'academicStanding',
    'accommodations',
    'advisorId',
    'advisorNotes',
    'courses',
    'completedCredits',
    'dateOfBirth',
    'directoryOptIn',
    'email',
    'financialHold',
    'fullName',
    'ownerUserId',
    'preferredName',
    'publicListing',
  ].sort(),
  'public view must remove every sensitive or unnecessary source field',
);

const publicSearch = runtime.runScenario(
  policyScenarios.find((scenario) => scenario.id === 'anonymous-public-search')!,
  'materialized',
);
strictEqual(publicSearch.privacy !== undefined, true);
strictEqual(
  publicSearch.privacy!.facets.some((facet) => facet.status === 'suppressed-small-cell'),
  true,
  'public facets must suppress small cells',
);
strictEqual(
  publicSearch.privacy!.facets.every((facet) => facet.count === null),
  true,
  'the synthetic public facet distribution should remain fully suppressed',
);

const allowedWrite = runtime.runScenario(
  policyScenarios.find((scenario) => scenario.id === 'student-own-preferences-write')!,
);
const deniedWrite = runtime.runScenario(
  policyScenarios.find((scenario) => scenario.id === 'student-sensitive-write')!,
);
strictEqual(allowedWrite.decision, 'allow');
strictEqual(deniedWrite.decision, 'deny');
strictEqual(deniedWrite.output, undefined, 'denied writes must not produce a mutation');

const projection = runtime.runScenario(
  policyScenarios.find((scenario) => scenario.id === 'directory-projection')!,
  'materialized',
);
const projectionSource = projection.source as {
  jsonapi: { version: string };
  links: { self: string };
  meta: { page: { total: number } };
  data: Array<{
    attributes: {
      dateOfBirth: string;
      financialHold: boolean;
      displayName: string;
      completedCredits: number;
      academicStanding: string;
    };
    meta: { realmURL: string; generation: number };
  }>;
};
strictEqual(projectionSource.jsonapi.version, '1.1', 'projection source must identify its JSON:API version');
strictEqual(projectionSource.meta.page.total, 12, 'projection source metadata must report the canonical corpus size');
strictEqual(projectionSource.data.length, 12, 'projection results must expose the actual canonical input in the harness');
strictEqual(
  typeof projectionSource.data[0]?.attributes.dateOfBirth,
  'string',
  'the canonical projection input must visibly contain fields removed from the mediated output',
);
strictEqual(
  typeof projectionSource.data[0]?.attributes.financialHold,
  'boolean',
  'the canonical projection input must visibly contain sensitive fields for comparison',
);
strictEqual(
  projectionSource.data[0]?.meta.realmURL,
  'https://example.edu/students/',
  'realm provenance belongs in resource metadata, not a custom top-level member',
);
strictEqual(typeof projectionSource.data[0]?.meta.generation, 'number');
const storedProjectionSource = projection.sourceDocument as {
  data: { attributes: Record<string, unknown> };
};
strictEqual(
  'displayName' in storedProjectionSource.data.attributes,
  false,
  'stored card source must precede computed displayName',
);
strictEqual(
  'completedCredits' in storedProjectionSource.data.attributes,
  false,
  'stored card source must precede computed completedCredits',
);
deepStrictEqual(
  projection.dataDiff?.sourceToCanonical.computedFields,
  ['displayName', 'completedCredits', 'academicStanding'],
);
strictEqual(projection.dataDiff?.rows.canonical, 12);
strictEqual(projection.dataDiff?.rows.mediated, 7);
strictEqual(projection.dataDiff?.rows.filtered, 5);
deepStrictEqual(
  projection.dataDiff?.rows.excludedIds,
  ['student-02', 'student-05', 'student-07', 'student-10', 'student-12'],
);
deepStrictEqual(
  projection.dataDiff?.rows.mediatedIds,
  ['student-01', 'student-03', 'student-04', 'student-06', 'student-08', 'student-09', 'student-11'],
);
strictEqual(projection.dataDiff?.canonicalToMediated.addedFields.includes('creditBand'), true);
strictEqual(projection.dataDiff?.canonicalToMediated.changedFields.includes('type'), true);

console.log(
  `Policy mediation: ${policyScenarios.length} cases passed; ${materializedRows} role-keyed views; on-demand/materialized parity and aggregate suppression verified`,
);
