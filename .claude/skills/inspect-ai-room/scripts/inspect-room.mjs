// Inspect local AI assistant rooms via the Matrix client API, logged in as
// the aibot user (which is a member of every assistant room).
//
//   node inspect-room.mjs rooms [N]          list the N most recent rooms (default 10)
//   node inspect-room.mjs timeline <roomId>  decoded event timeline (edits, tools, results)
//   node inspect-room.mjs usage <roomId>     per-turn token usage + session totals
//   node inspect-room.mjs state <roomId>     room state (LLM model, mode, skills)
//   node inspect-room.mjs raw <roomId> [filter]  full event JSON, optionally
//                                            only events whose JSON contains `filter`
//
// Env: MATRIX_URL (default http://localhost:8008),
//      BOXEL_AIBOT_PASSWORD (default 'pass').

const MATRIX_URL = process.env.MATRIX_URL || 'http://localhost:8008';
const PASSWORD = process.env.BOXEL_AIBOT_PASSWORD || 'pass';
const [, , cmd, arg1, arg2] = process.argv;

async function login() {
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
    let tools =
      c['app.boxel.toolRequests'] ?? c['app.boxel.commandRequests'];
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
  let sum = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 };
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
