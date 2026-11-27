import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MatrixEvent } from './matrix-api.ts';
import { analyzeRoom } from './room-analysis.ts';
import { routingLines, scoreRouting, skillsPath } from './routing.ts';

const BOT = '@aibot:localhost';
const USER = '@ai-assistant-eval-user-1:localhost';
const SKILLS = 'https://realm-server.example.localhost/skills/';

let clock = 0;

function userMessage(body: string): MatrixEvent {
  return {
    type: 'm.room.message',
    sender: USER,
    origin_server_ts: ++clock,
    content: { msgtype: 'app.boxel.message', body },
  } as unknown as MatrixEvent;
}

function editMessage(body: string): MatrixEvent {
  return {
    type: 'm.room.message',
    sender: USER,
    origin_server_ts: ++clock,
    content: {
      msgtype: 'app.boxel.message',
      body: `* ${body}`,
      'm.new_content': { msgtype: 'app.boxel.message', body },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$earlier' },
    },
  } as unknown as MatrixEvent;
}

// A finished bot turn, and when it reads files, the read's tool result with
// `resultKey` (`applied` for a read that reached the model).
function botTurn(
  reads: string[] = [],
  body = 'answer',
  resultKey = 'applied',
): MatrixEvent[] {
  let id = `read-${++clock}`;
  let turn = {
    type: 'm.room.message',
    sender: BOT,
    origin_server_ts: clock,
    content: {
      msgtype: 'app.boxel.message',
      isStreamingFinished: true,
      body,
      data: { usage: { promptTokens: 100, completionTokens: 10 } },
      'app.boxel.toolRequests': reads.length
        ? [
            {
              id,
              name: 'readRealmFile',
              arguments: { attributes: { urls: reads } },
            },
          ]
        : [],
    },
  } as unknown as MatrixEvent;
  if (!reads.length) {
    return [turn];
  }
  let result = {
    type: 'app.boxel.toolResult',
    sender: USER,
    origin_server_ts: ++clock,
    content: {
      commandRequestId: id,
      'm.relates_to': { rel_type: 'app.boxel.toolResult', key: resultKey },
    },
  } as unknown as MatrixEvent;
  return [turn, result];
}

test('a read is credited to the prompt it followed, not to a debug command', () => {
  let events = [
    userMessage('boxel-debug:feature:enable:example-feature'),
    ...botTurn([], 'example-feature is now enabled'),
    userMessage('Where am I?'),
    ...botTurn(),
    userMessage('How do I give my card its API key?'),
    ...botTurn([`${SKILLS}api-keys/SKILL.md`]),
    ...botTurn(),
    userMessage('Is it safe to paste it here?'),
    ...botTurn(),
  ];
  let analysis = analyzeRoom(events, BOT);
  assert.deepEqual(analysis.readsByPrompt, [
    [],
    [`${SKILLS}api-keys/SKILL.md`],
    [],
  ]);
});

test('an edit of an earlier message is not a new prompt', () => {
  let events = [
    userMessage('Where am I'),
    editMessage('Where am I?'),
    ...botTurn(),
    userMessage('How do I give my card its API key?'),
    ...botTurn([`${SKILLS}api-keys/SKILL.md`]),
  ];
  assert.deepEqual(analyzeRoom(events, BOT).readsByPrompt, [
    [],
    [`${SKILLS}api-keys/SKILL.md`],
  ]);
});

test('a read whose result was not applied is not credited', () => {
  let events = [
    userMessage('How do I give my card its API key?'),
    ...botTurn([`${SKILLS}api-keys/SKILL.md`], 'answer', 'failed'),
    userMessage('Is it safe to paste it here?'),
    ...botTurn([`${SKILLS}boxel-environment/SKILL.md`]),
  ];
  let analysis = analyzeRoom(events, BOT);
  assert.deepEqual(analysis.readsByPrompt, [
    [],
    [`${SKILLS}boxel-environment/SKILL.md`],
  ]);
  assert.deepEqual(analysis.filesRead, [`${SKILLS}boxel-environment/SKILL.md`]);
});

test('skillsPath reads a URL or the prefix form as a path in the skills realm', () => {
  assert.equal(
    skillsPath(`${SKILLS}boxel-environment/references/a%20b.md`, SKILLS),
    'boxel-environment/references/a b.md',
  );
  assert.equal(skillsPath(`${SKILLS}index.md`, SKILLS), 'index.md');
  assert.equal(
    skillsPath('@cardstack/skills/api-keys/SKILL.md', SKILLS),
    'api-keys/SKILL.md',
  );
  assert.equal(skillsPath('@cardstack/skills/index.md', SKILLS), 'index.md');
  assert.equal(skillsPath('@cardstack/base/card-api.gts', SKILLS), undefined);
  assert.equal(
    skillsPath(
      'https://realm-server.example.localhost/user/ws/Project/1.json',
      SKILLS,
    ),
    undefined,
  );
  assert.equal(skillsPath(`${SKILLS}api-keys/SKILL.md`, undefined), undefined);
});

test('a URL read matches wherever the prefix map serves the skills realm', () => {
  let served = 'https://skills.example.localhost/boxel-skills/';
  assert.equal(
    skillsPath(`${served}api-keys/SKILL.md`, served),
    'api-keys/SKILL.md',
  );
  assert.equal(skillsPath(`${SKILLS}api-keys/SKILL.md`, served), undefined);
});

test('a read in prefix form counts the same as one by URL', () => {
  let result = scoreRouting(
    ['What can I do?', 'Keys?'],
    [[], ['api-keys/']],
    [['@cardstack/skills/index.md'], ['@cardstack/skills/api-keys/SKILL.md']],
    { skillsRealmURL: SKILLS },
  );
  assert.deepEqual(
    result.prompts.map((row) => row.outcome),
    ['not-needed', 'opened'],
  );
  assert.deepEqual(result.prompts[1].opened, ['api-keys/SKILL.md']);
});

test('each outcome, with any-of and directory matching', () => {
  let result = scoreRouting(
    ['Where am I?', 'Kanban?', 'Keys?', 'Keys again?', 'Sync?', 'Cost?'],
    [
      [],
      ['catalog-reuse/SKILL.md', 'boxel-patterns/'],
      ['api-keys/SKILL.md'],
      ['api-keys/SKILL.md'],
      ['boxel-environment/references/shared-mirror-safety.md'],
      [],
    ],
    [
      [],
      [`${SKILLS}boxel-patterns/patterns/layout-kanban/README.md`],
      [`${SKILLS}api-keys/SKILL.md`],
      [],
      [`${SKILLS}boxel-environment/SKILL.md`],
      [`${SKILLS}glossary.md`],
    ],
    { skillsRealmURL: SKILLS },
  );
  assert.deepEqual(
    result.prompts.map((row) => row.outcome),
    ['not-needed', 'opened', 'opened', 'already-read', 'missed', 'read-anyway'],
  );
  assert.equal(result.met, 5);
  assert.equal(result.checked, 6);
  assert.equal(result.mismatch, undefined);
});

test('reading the always-loaded index is not a read', () => {
  let result = scoreRouting(
    ['What can I do?', 'Keys?'],
    [[], ['index.md']],
    [[`${SKILLS}index.md`], [`${SKILLS}index.md`]],
    { skillsRealmURL: SKILLS },
  );
  assert.deepEqual(
    result.prompts.map((row) => row.outcome),
    ['not-needed', 'missed'],
  );
});

test('an expected path the skills lack is unchecked, not missed', () => {
  let result = scoreRouting(
    ['Old question?', 'Keys?'],
    [['renamed/SKILL.md'], ['renamed/SKILL.md', 'api-keys/SKILL.md']],
    [[], []],
    {
      skillsRealmURL: SKILLS,
      exists: (path) => path !== 'renamed/SKILL.md',
    },
  );
  assert.deepEqual(
    result.prompts.map((row) => row.outcome),
    ['unchecked', 'missed'],
  );
  assert.deepEqual(result.prompts[1].notFound, ['renamed/SKILL.md']);
  assert.equal(result.checked, 1);
  assert.equal(result.met, 0);
  assert.match(routingLines(result)[0], /^"Old question\?": unchecked/);
});

test('prompts that do not line up with the room are flagged', () => {
  let result = scoreRouting(['One?', 'Two?'], [[], []], [[]], {
    skillsRealmURL: SKILLS,
  });
  assert.match(
    result.mismatch ?? '',
    /1 prompt\(s\) from the user, the evaluation 2/,
  );
});

test('expected paths match whatever their whitespace or leading slash', () => {
  let result = scoreRouting(
    ['Catalog?', 'Keys?'],
    [['/catalog-reuse/'], [' /api-keys/SKILL.md ']],
    [[`${SKILLS}catalog-reuse/SKILL.md`], [`${SKILLS}api-keys/SKILL.md`]],
    { skillsRealmURL: SKILLS },
  );
  assert.deepEqual(
    result.prompts.map((row) => row.outcome),
    ['opened', 'opened'],
  );
  assert.deepEqual(result.prompts[0].expected, ['catalog-reuse/']);
});

test('a workspace read is not a skill read', () => {
  let result = scoreRouting(
    ['Where am I?'],
    [[]],
    [['https://realm-server.example.localhost/user/ws/Project/1.json']],
    { skillsRealmURL: SKILLS },
  );
  assert.equal(result.prompts[0].outcome, 'not-needed');
  assert.deepEqual(result.prompts[0].opened, []);
});

test('paths under a feature the run turned off are unchecked', () => {
  let result = scoreRouting(
    ['Invoices?', 'Kanban?'],
    [['example-feature/'], ['boxel-patterns/', 'example-feature/']],
    [[], []],
    { skillsRealmURL: SKILLS, featuresOff: ['example-feature'] },
  );
  assert.deepEqual(
    result.prompts.map((row) => row.outcome),
    ['unchecked', 'missed'],
  );
  assert.deepEqual(result.prompts[0].featureOff, ['example-feature/']);
  assert.equal(result.checked, 1);
  assert.match(routingLines(result)[0], /feature off: example-feature\//);
});
