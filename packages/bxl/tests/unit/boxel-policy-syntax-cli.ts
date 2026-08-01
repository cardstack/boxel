import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  prepareBoxelPolicySafe,
  type BoxelPolicyDocument,
  type BoxelPolicySnapshot,
} from '../../src/authorization/index.js';

const document: BoxelPolicyDocument = {
  schema: 'boxel-policy/2',
  card: '../Policy/example',
  scopes: [
    {
      name: 'Project',
      adoptsFrom: '../projects/Project',
      seats: [
        { name: 'Owner', from: 'Card.Owner' },
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
      adoptsFrom: '../tasks/Task',
      links: [{ name: 'Project', to: '../projects/Project' }],
      seats: [{ name: 'Contributor' }, { name: 'Suspended' }],
      capabilities: [
        { name: 'Contribute', where: 'Seat.Contributor' },
        {
          name: 'Edit',
          where: 'via(Card.Project; Capability.View) or Capability.Contribute',
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

const snapshot: BoxelPolicySnapshot = {
  policy: {
    card: '../Policy/example',
    links: { administrators: ['../Person/administrator'] },
  },
  cards: [
    {
      card: '../Project/alpha',
      adoptsFrom: '../projects/Project',
      links: { owner: '../Person/owner' },
    },
    {
      card: '../Task/one',
      adoptsFrom: '../tasks/Task',
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
      scope: '../Task/one',
      seat: 'Contributor',
      holders: ['../Person/contributor', '../Person/suspended-contributor'],
    },
    {
      scope: '../Task/one',
      seat: 'Suspended',
      holders: ['../Person/suspended-contributor'],
    },
  ],
};

const prepared = prepareBoxelPolicySafe(document, snapshot);
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

for (const [party, capability, card, allowed] of expected) {
  const result = prepared.value.authorize({ party, capability, card, trace: true });
  strictEqual(result.ok, true, `${party} ${capability} ${card}`);
  if (!result.ok) continue;
  strictEqual(result.value.allowed, allowed, `${party} ${capability} ${card}`);
}

const refused = prepared.value.authorize({
  party: '../Person/suspended-contributor',
  capability: 'Publish',
  card: '../Task/one',
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
  card: '../Task/one',
});
strictEqual(listed.ok, true);
if (listed.ok) {
  deepStrictEqual(listed.value.capabilities, [
    'Contribute',
    'Edit',
    'PublicPreview',
  ]);
}

const invalidDocument: BoxelPolicyDocument = {
  ...document,
  scopes: [
    {
      name: 'Invalid',
      adoptsFrom: '../invalid/Invalid',
      capabilities: [{ name: 'View', where: 'Seat.Missing' }],
    },
  ],
};
const invalidSnapshot: BoxelPolicySnapshot = {
  cards: [{ card: '../Invalid/one', adoptsFrom: '../invalid/Invalid' }],
  parties: [{ party: '../Person/one' }],
};
const invalid = prepareBoxelPolicySafe(invalidDocument, invalidSnapshot);
strictEqual(invalid.ok, false);
if (!invalid.ok) strictEqual(invalid.error.kind, 'unknown-relation');

console.log(
  'Boxel Policy syntax: Seat, Capability, Party audiences, via, refusal precedence, enumeration, and validation passed',
);
