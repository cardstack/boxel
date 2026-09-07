// Measures whether the ai-bot's sliding sync request drops room events when
// several rooms change at once. It logs in as the bot, posts one harmless
// state event (m.room.topic) into N rooms back to back, syncs once with the
// given list window, and counts how many of the N events arrived; then posts
// three events into one room and counts again. Every event delivered is the
// pass condition. No model calls are made.
//
//   pnpm sliding-sync-drop-probe            # the window the bot uses
//   pnpm sliding-sync-drop-probe 0 1        # a one-room, one-event window
//
// Rooms come from PROBE_USERS (default smoke1,smoke2,smoke3, password
// PROBE_PASSWORD or "password"): every room such a user created, up to ten.
// MATRIX_URL, PROBE_BOT_USER and PROBE_BOT_PASSWORD default to the local
// synapse and aibot/pass.
const HS = process.env.MATRIX_URL ?? 'http://localhost:8008';
const [rangeEnd = 99, timelineLimit = 20] = process.argv.slice(2).map(Number);
const USERS = (process.env.PROBE_USERS ?? 'smoke1,smoke2,smoke3').split(',');
const PASSWORD = process.env.PROBE_PASSWORD ?? 'password';
async function login(user, password) {
  let r = await fetch(`${HS}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user },
      password,
    }),
  });
  return (await r.json()).access_token;
}
async function joinedRooms(token) {
  let r = await fetch(`${HS}/_matrix/client/v3/joined_rooms`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let rooms = (await r.json()).joined_rooms;
  let me = (
    await (
      await fetch(`${HS}/_matrix/client/v3/account/whoami`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()
  ).user_id;
  let own = [];
  for (let room of rooms) {
    let pl = await (
      await fetch(
        `${HS}/_matrix/client/v3/rooms/${encodeURIComponent(room)}/state/m.room.power_levels`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
    ).json();
    if ((pl.users?.[me] ?? pl.users_default ?? 0) >= 50) own.push(room);
  }
  return own;
}
async function sync(token, pos, timeout = 3000) {
  let body = {
    lists: {
      ai: {
        ranges: [[0, rangeEnd]],
        filters: { is_dm: false },
        timeline_limit: timelineLimit,
        required_state: [['*', '*']],
      },
    },
  };
  let url = `${HS}/_matrix/client/unstable/org.matrix.simplified_msc3575/sync?timeout=${timeout}${pos ? `&pos=${encodeURIComponent(pos)}` : ''}`;
  let r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
}
async function setTopic(token, roomId, topic) {
  let r = await fetch(
    `${HS}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.topic`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ topic }),
    },
  );
  if (!r.ok) throw new Error(await r.text());
}
function delivered(j, tag) {
  let out = [];
  for (let [id, r] of Object.entries(j.rooms ?? {}))
    for (let e of r.timeline ?? [])
      if (e.type === 'm.room.topic' && e.content?.topic?.startsWith(tag))
        out.push(`${id}:${e.content.topic}`);
  return out;
}
let bot = await login(
  process.env.PROBE_BOT_USER ?? 'aibot',
  process.env.PROBE_BOT_PASSWORD ?? 'pass',
);
let owners = [];
for (let u of USERS) {
  let t = await login(u, PASSWORD);
  for (let r of await joinedRooms(t)) owners.push({ room: r, token: t });
}
owners = owners.slice(0, 10);
console.log(
  `config: ranges [[0,${rangeEnd}]] timeline_limit ${timelineLimit}; ${owners.length} rooms`,
);
let j = await sync(bot, undefined, 1000);
let pos = j.pos;
let tag = `p${Date.now()}`;
await Promise.all(
  owners.map((o, i) => setTopic(o.token, o.room, `${tag}-room${i}`)),
);
j = await sync(bot, pos);
pos = j.pos;
let got = delivered(j, tag);
console.log(`10 rooms, one event each, one gap  -> delivered ${got.length}/10`);
let tag2 = `q${Date.now()}`;
for (let i = 0; i < 3; i++)
  await setTopic(owners[0].token, owners[0].room, `${tag2}-e${i}`);
j = await sync(bot, pos);
got = delivered(j, tag2);
console.log(
  `1 room, three events, one gap      -> delivered ${got.length}/3 (${got.map((g) => g.slice(g.lastIndexOf(':') + 1)).join(',')})`,
);
