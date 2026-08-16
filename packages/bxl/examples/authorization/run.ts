import { readFileSync } from 'node:fs';
import {
  prepareBxlAuthorizationSafe,
  type BxlAuthorizationCheckRequest,
  type BxlAuthorizationDocument,
  type BxlAuthorizationSnapshot,
} from '../../src/authorization/index.ts';

interface Fixture {
  provenance: { generalized: boolean; source: string; boundary: string };
  document: BxlAuthorizationDocument;
  snapshot: BxlAuthorizationSnapshot;
  checks: Array<
    BxlAuthorizationCheckRequest & { allowed: boolean; domain?: string }
  >;
}

function load(relative: string): Fixture {
  return JSON.parse(
    readFileSync(new URL(relative, import.meta.url), 'utf8'),
  ) as Fixture;
}

function run(name: string, fixture: Fixture): void {
  if (!fixture.provenance.generalized) {
    throw new Error(`${name} fixture must be generalized`);
  }
  const prepared = prepareBxlAuthorizationSafe(
    fixture.document,
    fixture.snapshot,
  );
  if (!prepared.ok) throw new Error(prepared.error.message);

  let allowed = 0;
  let refused = 0;
  for (const expected of fixture.checks) {
    const { allowed: expectedAllowed, domain: _domain, ...request } = expected;
    const result = prepared.value.checkCapability(request);
    if (!result.ok) throw new Error(result.error.message);
    if (result.value.allowed !== expectedAllowed) {
      throw new Error(
        `${name}: ${request.party} ${request.capability} ${request.resource} ` +
          `expected ${expectedAllowed ? 'allow' : 'refuse'}`,
      );
    }
    if (result.value.allowed) allowed++;
    else refused++;
  }

  console.log(
    `${name}: ${fixture.checks.length} decisions, ${allowed} allow, ${refused} refuse`,
  );
}

run(
  'coordination',
  load(
    '../../tests/authorization/fixtures/realm-collaboration/capability-scenarios.json',
  ),
);
run(
  'software-release',
  load(
    '../../tests/authorization/fixtures/software-release/release-governance.json',
  ),
);
