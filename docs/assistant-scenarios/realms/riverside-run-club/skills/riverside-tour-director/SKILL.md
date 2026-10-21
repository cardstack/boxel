---
name: riverside-tour-director
description: Directs the Riverside assistant tour, a scripted autumn relaunch of the Riverside Run Club that exercises every part of the assistant transcript. Use alongside the Realm Runner environment skill when the user works on the Autumn relaunch plan or follows the Tour script card.
boxel:
  kind: skill
  tools:
    - codeRef:
        module: ../../plan
        name: SetPlanFieldsTool
      requiresApproval: true
---

# Riverside tour director

The user is relaunching the Riverside Run Club. Every card lives in the realm
https://realms-staging.stack.cards/ctse/riverside-run-club/ (written REALM
below; paths in scripts are relative to it). Each request below has one right
way to answer it. Follow it exactly: the session is recorded, and anyone who
repeats the tour should see the same thing.

Cards:

- Club: REALM/Club/riverside
- Plan: REALM/RelaunchPlan/autumn
- Posters: REALM/PosterOption/dawn-patrol, REALM/PosterOption/night-shift, REALM/PosterOption/trail-mix
- Runners: REALM/Runner/<slug>
- Routes: REALM/Route/<slug>
- Sessions: REALM/Session/<yyyy-mm-dd>
- Races: REALM/Race/<slug>

Give every tool call a description of six words or fewer, naming the act and
its object ("Add accent border to poster"), never the reason or the tool.

Always name cards in replies with rich markdown: `:card[URL]` for a card in a
sentence, `::card[URL | fitted]` for a card on its own line, and
`::card[URL | embedded]` for the plan when it changes. A `:card` pill shows
the card's name, so never write the name again beside it: "You chose
:card[URL]." not "You chose :card[URL] Night Shift." Keep replies short.

## Show your work on the stack

The reader watches the stack beside the panel, so put the cards you work on
there. Each step below names a `set_view` call: make it as the step says,
with fully-qualified card URLs in `targets` and format `isolated`. The first
target replaces the stack; each further target opens on top of it, so the
last one is the card in front. Give it a description that names what the
reader is looking at ("Open the club"). Never open a card in edit format
while a tool writes to it.

## 1 · "Who are our regulars?"

Run this script with `run-realm-code`, exactly as written, including its
mistake (the runner fixes it):

```js
// Who ran at least 3 of the last 4 sessions, coaches left out, with a
// one-line welcome for each. Run it exactly as written.
const sessions = [
  'Session/2026-09-29.json',
  'Session/2026-10-06.json',
  'Session/2026-10-13.json',
  'Session/2026-10-18.json',
];
await realm.activity({ message: 'Reading the four sessions', current: 1, total: 4 };
const counts = {};
for (const path of sessions) {
  const doc = JSON.parse(await realm.fs.readText(path));
  for (const [key, rel] of Object.entries(doc.data.relationships ?? {})) {
    if (!key.startsWith('attendees.')) continue;
    const slug = rel.links.self.split('/').pop();
    counts[slug] = (counts[slug] ?? 0) + 1;
  }
}
await realm.activity({ message: 'Leaving out the coaches', current: 2, total: 4 });
const regulars = [];
for (const [slug, seen] of Object.entries(counts)) {
  if (seen < 3) continue;
  const runner = JSON.parse(await realm.fs.readText(`Runner/${slug}.json`));
  if (runner.data.attributes.status === 'Coach') continue;
  regulars.push({ slug, name: runner.data.attributes.name, sessions: seen });
}
await realm.activity({ message: 'Writing a welcome line for each', current: 3, total: 4 });
const welcome = await realm.resolve({
  instruction: 'Write a warm one-line welcome back (under 12 words) for each runner, by name.',
  input: regulars.map((r) => ({ name: r.name, sessions: r.sessions })),
  outputSchema: {
    type: 'object',
    properties: { lines: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, line: { type: 'string' } }, required: ['name', 'line'], additionalProperties: false } } },
    required: ['lines'],
    additionalProperties: false,
  },
});
await realm.activity({ message: `Found ${regulars.length} regulars`, current: 4, total: 4 });
return { regulars, welcome: welcome.output ?? welcome };
```

Then answer in one sentence naming the club with `:card[REALM/Club/riverside]`,
and list each regular as a bullet: `:card[REALM/Runner/<slug>]`, a dash, and
its welcome line.

Then call `set_view` with targets `["https://realms-staging.stack.cards/ctse/riverside-run-club/Club/riverside"]`, so the reader sees the club and its runners while you answer.

## 2 · "Find flat routes under 8 km, and any races in November"

Do not use `run-realm-code` for this. Call the entry search tool (its action verb is Search) twice, one call each, both with `realms` set to
`["https://realms-staging.stack.cards/ctse/riverside-run-club/"]`, scope
`cards` and limit 10:

1. Routes: query `{ "filter": { "on": { "module": "https://realms-staging.stack.cards/ctse/riverside-run-club/route", "name": "Route" }, "every": [ { "range": { "distanceKm": { "lt": 8 } } }, { "range": { "climbM": { "lt": 40 } } } ] } }`
2. Races: query `{ "filter": { "on": { "module": "https://realms-staging.stack.cards/ctse/riverside-run-club/race", "name": "Race" }, "range": { "date": { "gte": "2026-11-01", "lt": "2026-12-01" } } } }`

Answer in two short parts. Routes: each route on its own line as
`::card[URL | fitted]`. Races: one sentence, then each race as a `:card` pill
in a bullet with its date and bib fee.

Then call `set_view` with targets `["https://realms-staging.stack.cards/ctse/riverside-run-club/Route/river-loop", "https://realms-staging.stack.cards/ctse/riverside-run-club/Race/hudson-harvest-10k"]`: the club's home route, with the first November race on top.

## 3 · "Which poster should we use?"

Call `ask-user` with kind `cards`, the question "Which poster for the
relaunch?", and the three posters, each with its `cardId` (full URL) and its
title as label. Wait for the pick.

Before you ask, call `set_view` with targets `["https://realms-staging.stack.cards/ctse/riverside-run-club/PosterOption/dawn-patrol", "https://realms-staging.stack.cards/ctse/riverside-run-club/PosterOption/trail-mix", "https://realms-staging.stack.cards/ctse/riverside-run-club/PosterOption/night-shift"]`, so the posters stand on the stack while the question waits. After the pick, call `set_view` with only the chosen poster.

## 4 · "Pick an accent colour"

Call `ask-user` with kind `swatches`, the question "Which accent colour?" and
four options: #ff6b2c Ember, #5b8cff Night, #c6f432 Lime and #9bd46a Moss,
each with `color` and `label`.

## 5 · "When should the invite go out?"

Call `ask-user` with kind `options`, the question "Which day does the invite
go out?", options Tuesday, Wednesday and Thursday, and `allowOther: true`.

## 6 · "Put all of that on the plan"

Call SetPlanFieldsTool once on the plan, with fields poster (the chosen
poster's URL), accent (its hex), accentName (its name), sendDay and status
"Ready". Its description must be "Update 5 fields of Autumn relaunch". It
waits for the user's approval. Once it has run, show the plan with
`::card[REALM/RelaunchPlan/autumn | embedded]`.

Before the update, call `set_view` with targets `["https://realms-staging.stack.cards/ctse/riverside-run-club/RelaunchPlan/autumn"]`, so the reader watches the plan fill in when they approve.

## 7 · "Mark everyone who ran 3 of the last 4 sessions as Regular"

Run this script with `REGULARS` set to the regulars' slugs from step 1, then
answer in one sentence with the count:

```js
// Mark the regulars Regular, and count them on the plan. Run it with
// REGULARS replaced by the slugs the regulars script returned.
const REGULARS = [];
let done = 0;
for (const slug of REGULARS) {
  done += 1;
  await realm.activity({
    message: `Marking ${slug} Regular`,
    current: done,
    total: REGULARS.length,
  });
  await realm.cards.update(`Runner/${slug}`, { status: 'Regular' });
}
await realm.cards.update('RelaunchPlan/autumn', { regularsCount: done });
return { marked: done };
```

Then call `set_view` with targets `["https://realms-staging.stack.cards/ctse/riverside-run-club/Club/riverside", "https://realms-staging.stack.cards/ctse/riverside-run-club/Runner/priya-shah"]`: the club's runner grid with the new Regulars, and one regular in front.

## 8 · "Should the relaunch run be a 5K, a 10K or a relay? Recommend one"

Do not answer in prose. Call `ask-user` with kind `recommend`, the question
"Which distance for the relaunch run?", and three options in this order: 5K
first (detail: "Welcoming for every level, and the Boathouse 5K is already
measured", confidence "high"), then 10K (detail: "Keeps the regulars
challenged, but newcomers drop out", confidence "medium"), then Relay
(detail: "Fun in teams, but needs more marshals and timing", confidence
"medium"). Wait for the pick, then set it on the plan with SetPlanFieldsTool
(fields distance; description "Set the relaunch distance").

After the pick, call `set_view` with targets `["https://realms-staging.stack.cards/ctse/riverside-run-club/RelaunchPlan/autumn", "https://realms-staging.stack.cards/ctse/riverside-run-club/Route/boathouse-5k"]`: the 5K's route in front of the plan.

## 9 · "Check the regulars' paces and ask me which group leads the 5K"

Run this script with `run-realm-code`, exactly as written. In Ask mode it
waits for the user's click before it runs; it then asks its question in the
row and writes the answer to the plan:

```js
// The regulars' paces, then the reader picks who leads the 5K. Run it
// exactly as written.
await realm.plan(['Read the regulars', 'Ask who leads', 'Note it on the plan']);
await realm.activity({ message: 'Reading the regulars', current: 1, total: 3 });
const found = await realm.cards.search({
  filter: {
    on: {
      module:
        'https://realms-staging.stack.cards/ctse/riverside-run-club/runner',
      name: 'Runner',
    },
    eq: { status: 'Regular' },
  },
});
const rows = Array.isArray(found) ? found : (found?.data ?? found?.results ?? []);
const paces = rows.map((r) => ({ name: r.attributes?.name ?? r.name, pace: r.attributes?.paceSeconds ?? r.paceSeconds }));
  name: r.attributes?.name ?? r.name,
  pace: r.attributes?.paceSeconds ?? r.paceSeconds,
}));
const fast = paces.filter((r) => r.pace < 300).map((r) => r.name);
const steady = paces.filter((r) => r.pace >= 300).map((r) => r.name);
await realm.activity({
  message: 'Asking who leads the 5K',
  current: 2,
  total: 3,
});
const { label } = await realm.ask({
  question: 'Which group leads the relaunch 5K?',
  options: [
    { label: 'The fast group', detail: fast.join(', ') },
    { label: 'The steady group', detail: steady.join(', ') },
    { label: 'Mixed pacers', detail: 'One from each group per kilometre' },
  ],
});
await realm.activity({
  message: 'Noting it on the plan',
  current: 3,
  total: 3,
});
await realm.cards.update('RelaunchPlan/autumn', {
  status: `Ready · ${label} leads`,
});
return { leads: label, fast, steady };
```

Then say in one sentence who leads.

Before the script, call `set_view` with targets `["https://realms-staging.stack.cards/ctse/riverside-run-club/RelaunchPlan/autumn", "https://realms-staging.stack.cards/ctse/riverside-run-club/Session/2026-10-13"]`: the last tempo session, whose runners' paces the script reads.

## 10 · "What do the races near Riverside Park charge for bibs?"

Use the `research` tool with execution `background`, scoped to road races and
race organisers near Riverside Park, New York, this autumn. It returns at once
with a run that keeps working in the background. Reply with one sentence: the
research is running and its table will be posted here when it finishes. Do
not wait for it and do not make the table yet.

## 10b · A message saying a background run finished

When a message says the background run finished and attaches its result,
answer with a small markdown table built from the attached result: race,
bib fee, source link. Lead with two stat chips (the cheapest and the dearest
fee), number the sources in the prose, and end with a one-line Method note.
Never say the research is still running.

## 11 · "Check kids' race fees borough by borough"

Run this script with `run-realm-code`, exactly as written. It names its steps
up front with `realm.plan`, so the reader can follow the checklist, and it
turns this skill on again with `room.enableSkills`, which the transcript shows
as a line about the room. Keep every line, the `room.enableSkills` call
included, even though the skill is already on:

```js
// Kids' race fees, one borough per step. Run it exactly as written.
await realm.plan([
  'Search Manhattan',
  'Search Brooklyn',
  'Search Queens',
  'Search the Bronx',
]);
const boroughs = ['Manhattan', 'Brooklyn', 'Queens', 'The Bronx'];
const found = {};
for (let i = 0; i < boroughs.length; i++) {
  await realm.activity({
    message: `Searching ${boroughs[i]}`,
    current: i + 1,
    total: boroughs.length,
  });
  const results = await realm.web.search(
    `kids race entry fees ${boroughs[i]} New York`,
    { limit: 2 },
  );
  found[boroughs[i]] = results.map((r) => ({ title: r.title, url: r.url }));
}
await room.enableSkills([
  'https://realms-staging.stack.cards/ctse/riverside-run-club/skills/riverside-tour-director/SKILL.md',
]);
return found;
```

Answer with one short line per borough, each naming a race and linking its
page. If the result says the user stopped it, say in one sentence that it was
stopped and nothing was saved, and do not run it again unless they ask.

## 12 · "Open the poster's code and give it a border in the plan's accent"

Run this script with `run-realm-code`, exactly as written. It opens the file
in the editor and makes the change; the row shows the change as a diff, and
the user can undo it from the row:

```js
// Give the plan's poster a border in the plan's accent. Run it exactly as written.
await realm.ui.openFile('plan.gts');
await realm.fs.replace(
  'plan.gts',
  '          aspect-ratio: 3 / 4;\n          border-radius: 6px;\n',
  '          aspect-ratio: 3 / 4;\n          border-radius: 6px;\n          outline: 4px solid var(--accent);\n          outline-offset: 4px;\n',
);
return 'done';
```

Then say in one sentence what changed. If the user then says they undid it,
answer in one sentence and do not change the file again.

## 13 · "Sum it up"

Reply with: one sentence naming the plan with `:card`, a four-row markdown
table (Poster, Accent, Invite goes out, Relaunch run), and the plan as
`::card[REALM/RelaunchPlan/autumn | fitted]`.

Before you answer, call `set_view` with targets `["https://realms-staging.stack.cards/ctse/riverside-run-club/Club/riverside", "https://realms-staging.stack.cards/ctse/riverside-run-club/RelaunchPlan/autumn"]`, so the finished plan stands in front of the club.

## Reset · "Reset the tour"

Run this script with `run-realm-code`, exactly as written, then say in one
sentence that the tour is ready to run again:

```js
// Put the plan and the runners back where the tour starts. Run it exactly as written.
await realm.activity({ message: 'Resetting the plan', current: 1, total: 2 });
await realm.fs.writeText(
  'RelaunchPlan/autumn.json',
  JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          name: 'Autumn relaunch',
          accent: null,
          accentName: null,
          sendDay: null,
          distance: null,
          status: 'Draft',
          regularsCount: 0,
        },
        relationships: {
          club: { links: { self: '../Club/riverside' } },
          'cardInfo.theme': { links: { self: '../Theme/riverside' } },
        },
        meta: { adoptsFrom: { module: '../plan', name: 'RelaunchPlan' } },
      },
    },
    null,
    2,
  ),
);
await realm.activity({
  message: 'Resetting the runners',
  current: 2,
  total: 2,
});
const FIRST = { 'lena-ruiz': 'Coach' };
for (const slug of [
  'lena-ruiz',
  'omar-haddad',
  'priya-shah',
  'tom-okafor',
  'iris-tanaka',
  'ben-carter',
  'grace-liu',
  'noah-fischer',
  'maya-patel',
  'sean-doyle',
  'kara-oneill',
  'jonah-weiss',
]) {
  await realm.cards.update(`Runner/${slug}`, {
    status: FIRST[slug] ?? 'Member',
  });
}
return 'reset';
```
