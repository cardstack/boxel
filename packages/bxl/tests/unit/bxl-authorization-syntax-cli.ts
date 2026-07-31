import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  prepareBxlAuthorizationSafe,
  type BxlAuthorizationDocument,
  type BxlAuthorizationSnapshot,
} from '../../src/authorization/index.js';

const document: BxlAuthorizationDocument = {
  schema: 'bxl-authorization/1',
  id: 'example',
  scopes: [
    {
      name: 'Project',
      seats: [
        { name: 'Owner', from: 'Resource.Owner' },
        { name: 'Administrator', from: 'Policy.Administrators' },
      ],
      capabilities: [
        {
          name: 'View',
          where: 'Seat.Owner or Seat.Administrator',
        },
      ],
    },
    {
      name: 'Task',
      links: [{ name: 'Project', to: 'Project' }],
      seats: [{ name: 'Contributor' }, { name: 'Suspended' }],
      capabilities: [
        { name: 'Contribute', where: 'Seat.Contributor' },
        {
          name: 'Edit',
          where: 'via(Resource.Project; Capability.View) or Capability.Contribute',
        },
        { name: 'PublicPreview', where: 'Party.Anyone' },
        { name: 'MemberPreview', where: 'Party.Member' },
        { name: 'GuestPreview', where: 'Party.Guest' },
        {
          name: 'Publish',
          where: 'Seat.Contributor',
          refuse: [
            {
              when: 'Seat.Suspended',
              because: 'Suspended contributors cannot publish.',
            },
          ],
        },
      ],
    },
  ],
};

const snapshot: BxlAuthorizationSnapshot = {
  policy: {
    id: 'example',
    links: { administrators: ['../Person/administrator'] },
  },
  resources: [
    {
      resource: '../Project/alpha',
      type: 'Project',
      links: { owner: '../Person/owner' },
    },
    {
      resource: '../Task/one',
      type: 'Task',
      links: { project: '../Project/alpha' },
    },
  ],
  parties: [
    { party: '../Person/owner' },
    { party: '../Person/administrator' },
    { party: '../Person/contributor' },
    { party: '../Person/suspended-contributor' },
    { party: '../Person/member' },
    { party: '../Person/guest' },
    { party: '../Person/known-outsider' },
  ],
  members: ['../Person/member'],
  guests: ['../Person/guest'],
  seats: [
    {
      resource: '../Task/one',
      seat: 'Contributor',
      holders: ['../Person/contributor', '../Person/suspended-contributor'],
    },
    {
      resource: '../Task/one',
      seat: 'Suspended',
      holders: ['../Person/suspended-contributor'],
    },
  ],
};

const prepared = prepareBxlAuthorizationSafe(document, snapshot);
strictEqual(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.error.message);

const expected = [
  ['../Person/owner', 'View', '../Project/alpha', true],
  ['../Person/administrator', 'View', '../Project/alpha', true],
  ['../Person/owner', 'Edit', '../Task/one', true],
  ['../Person/contributor', 'Edit', '../Task/one', true],
  ['../Person/known-outsider', 'Edit', '../Task/one', false],
  ['../Person/known-outsider', 'PublicPreview', '../Task/one', true],
  ['../Person/not-in-snapshot', 'PublicPreview', '../Task/one', true],
  ['../Person/member', 'MemberPreview', '../Task/one', true],
  ['../Person/guest', 'MemberPreview', '../Task/one', false],
  ['../Person/guest', 'GuestPreview', '../Task/one', true],
  ['../Person/member', 'GuestPreview', '../Task/one', false],
  ['../Person/contributor', 'Publish', '../Task/one', true],
  ['../Person/suspended-contributor', 'Publish', '../Task/one', false],
] as const;

for (const [party, capability, resource, allowed] of expected) {
  const result = prepared.value.checkCapability({ party, capability, resource, trace: true });
  strictEqual(result.ok, true, `${party} ${capability} ${resource}`);
  if (!result.ok) continue;
  strictEqual(result.value.allowed, allowed, `${party} ${capability} ${resource}`);
}

const refused = prepared.value.checkCapability({
  party: '../Person/suspended-contributor',
  capability: 'Publish',
  resource: '../Task/one',
});
strictEqual(refused.ok, true);
if (refused.ok) {
  deepStrictEqual(refused.value.because, [
    {
      kind: 'refusal',
      message: 'Suspended contributors cannot publish.',
    },
  ]);
}

const listed = prepared.value.listCapabilities({
  party: '../Person/suspended-contributor',
  resource: '../Task/one',
});
strictEqual(listed.ok, true);
if (listed.ok) {
  deepStrictEqual(listed.value.capabilities, [
    'Contribute',
    'Edit',
    'PublicPreview',
  ]);
}

const invalidDocument: BxlAuthorizationDocument = {
  ...document,
  scopes: [
    {
      name: 'Invalid',
      capabilities: [{ name: 'View', where: 'Seat.Missing' }],
    },
  ],
};
const invalidSnapshot: BxlAuthorizationSnapshot = {
  resources: [{ resource: '../Invalid/one', type: 'Invalid' }],
  parties: [{ party: '../Person/one' }],
};
const invalid = prepareBxlAuthorizationSafe(invalidDocument, invalidSnapshot);
strictEqual(invalid.ok, false);
if (!invalid.ok) strictEqual(invalid.error.kind, 'unknown-relation');

console.log(
  'BXL Authorization syntax: Seat, Capability, Party audiences, via, refusal precedence, enumeration, and validation passed',
);
