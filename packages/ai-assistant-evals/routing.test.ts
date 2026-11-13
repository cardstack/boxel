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

function botTurn(reads: string[] = [], body = 'answer'): MatrixEvent {
  return {
    type: 'm.room.message',
    sender: BOT,
    origin_server_ts: ++clock,
    content: {
      msgtype: 'app.boxel.message',
      isStreamingFinished: true,
      body,
      data: { usage: { promptTokens: 100, completionTokens: 10 } },
      'app.boxel.toolRequests': reads.length
        ? [
            {
              id: `read-${clock}`,
              name: 'readRealmFile',
              arguments: { attributes: { urls: reads } },
            },
          ]
        : [],
    },
  } as unknown as MatrixEvent;
}

test('a read is credited to the prompt it followed, not to a debug command', () => {
  let events = [
    userMessage('boxel-debug:feature:enable:catalog-reuse'),
    botTurn([], 'catalog-reuse is now enabled'),
    userMessage('Where am I?'),
    botTurn(),
    userMessage('How do I give my card its API key?'),
    botTurn([`${SKILLS}api-keys/SKILL.md`]),
    botTurn(),
    userMessage('Is it safe to paste it here?'),
    botTurn(),
  ];
  let analysis = analyzeRoom(events, BOT);
  assert.deepEqual(analysis.readsByPrompt, [
    [],
    [`${SKILLS}api-keys/SKILL.md`],
    [],
  ]);
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
  assert.equal(
    skillsPath('@cardstack/base/card-api.gts', SKILLS),
    '@cardstack/base/card-api.gts',
  );
});

test('a URL read matches wherever the prefix map serves the skills realm', () => {
  let served = 'https://skills.example.localhost/boxel-skills/';
  assert.equal(
    skillsPath(`${served}api-keys/SKILL.md`, served),
    'api-keys/SKILL.md',
  );
  assert.equal(
    skillsPath(`${SKILLS}api-keys/SKILL.md`, served),
    `${SKILLS}api-keys/SKILL.md`,
  );
});

test('a read in prefix form counts the same as one by URL', () => {
  let result = scoreRouting(
    ['What can I do?', 'Keys?'],
    [[], ['api-keys/']],
    [['@cardstack/skills/index.md'], ['@cardstack/skills/api-keys/SKILL.md']],
    SKILLS,
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
    SKILLS,
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
    SKILLS,
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
    SKILLS,
    (path) => path !== 'renamed/SKILL.md',
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
  let result = scoreRouting(['One?', 'Two?'], [[], []], [[]], SKILLS);
  assert.match(
    result.mismatch ?? '',
    /1 prompt\(s\) from the user, the evaluation 2/,
  );
});
