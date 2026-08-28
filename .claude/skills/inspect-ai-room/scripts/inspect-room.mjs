// Inspect AI assistant rooms via the Matrix client API. Locally this logs in
// as the aibot user (a member of every assistant room); against staging /
// production it reuses a boxel-cli profile's Matrix token (see Auth below).
//
//   node inspect-room.mjs rooms [N]          list the N most recent rooms (default 10)
//   node inspect-room.mjs timeline <roomId>  decoded event timeline (edits, tools, results)
//   node inspect-room.mjs usage <roomId>     per-turn token usage + session totals
//   node inspect-room.mjs state <roomId>     room state (LLM model, mode, skills)
//   node inspect-room.mjs raw <roomId> [filter]  full event JSON, optionally
//                                            only events whose JSON contains `filter`
//
// Auth (first match wins):
//   --profile <id>   use a boxel-cli profile from ~/.boxel-cli/profiles.json
//                    (its matrixUrl + matrixAccessToken); this is how staging /
//                    production rooms are inspected — the profile's user must be
//                    a member of the room. `--profile staging` matches any
//                    profile whose matrixUrl contains "staging".
//   MATRIX_TOKEN     env: raw access token, used with MATRIX_URL
//   aibot login      env MATRIX_URL (default http://localhost:8008) +
//                    BOXEL_AIBOT_PASSWORD (default 'pass'); local synapse only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let argv = process.argv.slice(2);
let profileArg;
let pi = argv.indexOf('--profile');
if (pi !== -1) {
  profileArg = argv[pi + 1];
  argv.splice(pi, 2);
}
const [cmd, arg1, arg2] = argv;

function loadProfile(idOrHint) {
  let file = path.join(os.homedir(), '.boxel-cli', 'profiles.json');
  let profiles = JSON.parse(fs.readFileSync(file, 'utf8')).profiles ?? {};
  let p =
    profiles[idOrHint] ??
    Object.values(profiles).find((x) => x.matrixUrl?.includes(idOrHint));
  if (!p) {
    throw new Error(
      `no boxel-cli profile matching "${idOrHint}"; have: ${Object.keys(profiles).join(', ')}`,
    );
  }
  if (!p.matrixAccessToken) {
    throw new Error(
      `profile ${p.matrixUserId} has no stored Matrix token; run \`boxel profile add\``,
    );
  }
  return p;
}

let profile = profileArg ? loadProfile(profileArg) : undefined;
const MATRIX_URL =
  profile?.matrixUrl || process.env.MATRIX_URL || 'http://localhost:8008';
const PASSWORD = process.env.BOXEL_AIBOT_PASSWORD || 'pass';

async function login() {
  if (profile) return profile.matrixAccessToken;
  if (process.env.MATRIX_TOKEN) return process.env.MATRIX_TOKEN;
  let res = await fetch(new URL('/_matrix/client/v3/login', MATRIX_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: 'aibot' },
      password: PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`login: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function api(token, path, params = {}) {
  let url = new URL(`/_matrix/client/v3${path}`, MATRIX_URL);
  for (let [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Pull the full timeline oldest-first (paginates until exhausted).
async function allEvents(token, roomId) {
  let events = [];
  let from;
  while (true) {
    let page = await api(
      token,
      `/rooms/${encodeURIComponent(roomId)}/messages`,
      { dir: 'b', limit: '500', ...(from ? { from } : {}) },
    );
    events.push(...page.chunk);
    if (!page.end || page.chunk.length === 0) break;
    from = page.end;
  }
  return events.reverse();
}

// `data` is a JSON string on the wire; parse defensively.
function eventData(content) {
  let d = content?.data;
  if (typeof d === 'string') {
    try {
      return JSON.parse(d);
    } catch {
      return undefined;
    }
  }
  return d;
}

function ts(e) {
  return new Date(e.origin_server_ts).toISOString().slice(11, 19);
}

if (cmd === 'rooms') {
  let token = await login();
  let joined = (await api(token, '/joined_rooms')).joined_rooms;
  let rooms = [];
  for (let roomId of joined) {
    try {
      let page = await api(
        token,
        `/rooms/${encodeURIComponent(roomId)}/messages`,
        { dir: 'b', limit: '1' },
      );
      let last = page.chunk[0];
      if (last) rooms.push({ roomId, lastTs: last.origin_server_ts });
    } catch {
      // room without readable history; skip
    }
  }
  rooms.sort((a, b) => b.lastTs - a.lastTs);
  for (let r of rooms.slice(0, Number(arg1 ?? 10))) {
    let state = await api(
      token,
      `/rooms/${encodeURIComponent(r.roomId)}/state`,
    );
    let name = state.find((e) => e.type === 'm.room.name')?.content?.name;
    console.log(
      new Date(r.lastTs).toISOString().slice(0, 19),
      r.roomId,
      '|',
      name ?? '(unnamed)',
    );
  }
} else if (cmd === 'timeline') {
  let token = await login();
  for (let e of await allEvents(token, arg1)) {
    let c = e.content ?? {};
    let parts = [];
    if (c['m.relates_to']?.rel_type) parts.push(c['m.relates_to'].rel_type);
    if (c.isStreamingFinished !== undefined)
      parts.push(`fin=${c.isStreamingFinished}`);
    // Rooms from before the command→tool rename carry requests under the
    // legacy key; read both, like runtime-common's getToolRequests().
    let tools = c['app.boxel.toolRequests'] ?? c['app.boxel.commandRequests'];
    if (tools?.length)
      parts.push('tools=' + tools.map((t) => t.name).join(','));
    let agent = eventData(c)?.context?.agentId;
    if (agent) parts.push('agent=' + agent.slice(0, 8));
    let usage = eventData(c)?.usage;
    if (usage)
      parts.push(
        `usage=${usage.promptTokens}in/${usage.completionTokens}out/${usage.cachedTokens ?? 0}cached`,
      );
    let body = (c.body ?? '').slice(0, 90).replace(/\n/g, ' ');
    console.log(
      ts(e),
      e.sender.padEnd(16).slice(0, 16),
      e.type.replace('app.boxel.', '~'),
      parts.join(' | '),
      body ? ':: ' + body : '',
    );
  }
} else if (cmd === 'usage') {
  let token = await login();
  let turns = [];
  for (let e of await allEvents(token, arg1)) {
    let usage = eventData(e.content)?.usage;
    // usage rides the final edit of each answer; edits of one answer share
    // the original event id, so keep the last value per answer.
    if (usage && e.sender.startsWith('@aibot')) {
      let key = e.content['m.relates_to']?.event_id ?? e.event_id;
      let existing = turns.find((t) => t.key === key);
      if (existing) existing.usage = usage;
      else turns.push({ key, usage });
    }
  }
  let sum = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
  };
  for (let [i, t] of turns.entries()) {
    let u = t.usage;
    console.log(
      `turn ${i + 1}: ${u.promptTokens} in (${u.cachedTokens ?? 0} cached) · ${u.completionTokens} out · $${(u.costUsd ?? 0).toFixed(4)}`,
    );
    sum.promptTokens += u.promptTokens ?? 0;
    sum.completionTokens += u.completionTokens ?? 0;
    sum.cachedTokens += u.cachedTokens ?? 0;
    sum.costUsd += u.costUsd ?? 0;
  }
  console.log(
    `TOTAL: ${sum.promptTokens} in (${sum.cachedTokens} cached) · ${sum.completionTokens} out · $${sum.costUsd.toFixed(4)} over ${turns.length} turns`,
  );
} else if (cmd === 'state') {
  let token = await login();
  let state = await api(token, `/rooms/${encodeURIComponent(arg1)}/state`);
  for (let e of state) {
    if (
      ['m.room.name', 'app.boxel.active-llm', 'app.boxel.llm-mode'].includes(
        e.type,
      ) ||
      e.type.includes('skills')
    ) {
      console.log(e.type, JSON.stringify(e.content));
    }
  }
} else if (cmd === 'raw') {
  let token = await login();
  for (let e of await allEvents(token, arg1)) {
    let s = JSON.stringify(e);
    if (!arg2 || s.includes(arg2)) console.log(s);
  }
} else {
  console.error(
    'usage: inspect-room.mjs rooms [N] | timeline <roomId> | usage <roomId> | state <roomId> | raw <roomId> [filter]',
  );
  process.exit(1);
}
