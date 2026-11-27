// Turns an AI assistant room's events (oldest first, as the Matrix client API
// returns them) into a replay fixture for the host's motion replay test
// (packages/host/tests/integration/components/ai-assistant-panel/
// motion-replay-test.gts; the format is RoomReplayFixture in
// packages/host/tests/helpers/ai-room-replay.ts).
//
// The last `turns` turns play on the clock; everything before them is the
// room as the reader found it and lands at once. Gaps longer than `maxGap` are
// cut to it, so a session the reader paused in replays in seconds.
//
// The bot streams a reply over to-device previews, which the room does not
// keep: only the reply's placeholder and its final edit are in the timeline.
// Previews are made up from the final edit at the bot's own cadence (250 ms)
// over the time the reply took, capped at `maxStream`, revealing its
// reasoning, then its body. A room the bot streamed with room edits
// (AI_BOT_STREAMING_MODE=room-edits) already holds every step and gets none.
//
// By default every word of text (bodies, reasoning, tool arguments) is
// replaced by filler of the same shape: letters by letters, digits by digits,
// punctuation, whitespace and Markdown kept. The transcript lays out the same,
// and nothing a person wrote or was told leaves the room. `keepText` turns
// that off, for a fixture that stays on the machine that made it.

const BOT = /^@aibot:/;
const TOOL_RESULT_TYPES = new Set([
  'app.boxel.toolResult',
  'app.boxel.commandResult',
]);
const KEPT_TYPES = new Set([
  'm.room.message',
  'app.boxel.compaction',
  ...TOOL_RESULT_TYPES,
]);
const SKIPPED_MSGTYPES = new Set(['app.boxel.realm-server-event']);
const REASONING = 'app.boxel.reasoning';
const TOOL_REQUESTS = 'app.boxel.toolRequests';
const LEGACY_TOOL_REQUESTS = 'app.boxel.commandRequests';
const EXTERNAL_FIELDS = 'app.boxel.externalFields';
// keys whose string values are structure, not text: kept as they are
const STRUCTURAL_KEYS = new Set([
  'id',
  'name',
  'msgtype',
  'format',
  'rel_type',
  'key',
  'event_id',
  'commandRequestId',
  'toolCallId',
  'type',
  'agentId',
  'status',
  'executedBy',
]);
const CADENCE = 250;

export function roomToFixture(rawEvents, opts = {}) {
  let {
    turns = 1,
    maxGap = 1500,
    maxStream = 4000,
    keepText = false,
    description,
    source = {},
  } = opts;
  let notes = [];
  let events = rawEvents.filter(
    (e) =>
      KEPT_TYPES.has(e.type) &&
      e.state_key === undefined &&
      !e.unsigned?.redacted_because &&
      !SKIPPED_MSGTYPES.has(e.content?.msgtype),
  );
  if (!events.length) {
    throw new Error('the room has no messages to replay');
  }

  // a turn starts at each message the reader sent
  let isPrompt = (e) =>
    !BOT.test(e.sender) &&
    e.type === 'm.room.message' &&
    e.content?.['m.relates_to']?.rel_type !== 'm.replace';
  let promptAt = events
    .map((e, i) => (isPrompt(e) ? i : -1))
    .filter((i) => i >= 0);
  let playFrom =
    promptAt.length >= turns ? promptAt[promptAt.length - turns] : 0;

  // the clock: recorded gaps, each cut to maxGap, except the time a reply
  // took to stream, which is cut to maxStream
  let finalOf = new Map();
  for (let e of events) {
    let rel = e.content?.['m.relates_to'];
    if (rel?.rel_type === 'm.replace' && e.content?.isStreamingFinished) {
      finalOf.set(rel.event_id, e);
    }
  }
  let placeholderOf = new Map(
    [...finalOf.entries()].map(([orig, fin]) => [fin.event_id, orig]),
  );
  let at = new Map();
  let t = 0;
  for (let [i, e] of events.entries()) {
    if (i > 0) {
      let gap = Math.max(
        0,
        e.origin_server_ts - events[i - 1].origin_server_ts,
      );
      let orig = placeholderOf.get(e.event_id);
      let streamed = orig !== undefined && events[i - 1].event_id === orig;
      t += Math.min(gap, streamed ? maxStream : maxGap);
    }
    at.set(e.event_id, t);
  }

  let edited = new Set(
    events
      .filter(
        (e) =>
          e.content?.['m.relates_to']?.rel_type === 'm.replace' &&
          !e.content?.isStreamingFinished,
      )
      .map((e) => e.content['m.relates_to'].event_id),
  );
  let filler = keepText ? (s) => s : fill;
  let out = [];
  let dropped = new Set();
  for (let [i, e] of events.entries()) {
    let phase = i < playFrom ? 'history' : 'turn';
    let content = cleanContent(e, filler, dropped);
    out.push({
      at: at.get(e.event_id),
      kind: 'room',
      ...(phase === 'history' ? { phase } : {}),
      id: e.event_id,
      sender: BOT.test(e.sender) ? 'bot' : 'user',
      ...(e.type === 'm.room.message' ? {} : { type: e.type }),
      content,
    });
    // a reply streamed over to-device: make up its previews
    let fin = finalOf.get(e.event_id);
    if (phase === 'turn' && fin && !edited.has(e.event_id)) {
      out.push(
        ...previews(
          e.event_id,
          at.get(e.event_id),
          at.get(fin.event_id),
          cleanContent(fin, filler, dropped),
        ),
      );
    }
  }
  out.sort((a, b) => a.at - b.at);
  for (let what of dropped) {
    notes.push(what);
  }
  if (out.some((e) => e.kind === 'preview')) {
    notes.push(
      `streaming made up from each reply's final edit, a preview every ${CADENCE} ms`,
    );
  }
  return {
    version: 1,
    description:
      description ??
      `${turns} turn${turns === 1 ? '' : 's'} of a recorded room`,
    source: {
      ...source,
      // a room id points back at the person whose room it is
      roomId: keepText ? source.roomId : undefined,
      exportedAt: new Date().toISOString(),
      anonymized: !keepText,
      notes,
    },
    events: out,
  };
}

// what the panel needs of an event, with text filled in and what the test
// cannot serve (Matrix media, attachments) left out
function cleanContent(e, filler, dropped) {
  let c = structuredClone(e.content ?? {});
  delete c.formatted_body;
  if (typeof c.body === 'string') c.body = filler(c.body);
  if (typeof c[REASONING] === 'string') c[REASONING] = filler(c[REASONING]);
  for (let key of [TOOL_REQUESTS, LEGACY_TOOL_REQUESTS]) {
    if (Array.isArray(c[key])) {
      c[key] = c[key].map((request) => fillTree(request, filler));
    }
  }
  if (c[EXTERNAL_FIELDS]) {
    dropped.add(
      'fields the room kept in Matrix media (app.boxel.externalFields) are left out',
    );
    delete c[EXTERNAL_FIELDS];
  }
  let data = c.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = undefined;
    }
  }
  if (data && typeof data === 'object') {
    let kept = {};
    if (data.context?.agentId) kept.context = { agentId: data.context.agentId };
    if (data.usage) kept.usage = data.usage;
    if (
      data.attachedCards ||
      data.attachedFiles ||
      data.attachedCardsEventIds
    ) {
      dropped.add('attached cards and files are left out');
    }
    if (data.card) {
      dropped.add(
        "tool results' output cards (in Matrix media) are left out: those results replay without output",
      );
    }
    c.data = kept;
  }
  if (c.msgtype === 'app.boxel.toolResultWithOutput') {
    c.msgtype = 'app.boxel.toolResultWithNoOutput';
  }
  return c;
}

function previews(parent, from, to, final) {
  let body = final.body ?? '';
  let reasoning = final[REASONING] ?? '';
  let steps = Math.floor((to - from) / CADENCE) - 1;
  let out = [];
  for (let k = 1; k <= steps; k++) {
    let p = k / (steps + 1);
    // reasoning streams first, over its share of the reply
    let share = reasoning ? 0.4 : 0;
    let r = share ? Math.min(1, p / share) : 1;
    let b = p <= share ? 0 : (p - share) / (1 - share);
    out.push({
      at: from + k * CADENCE,
      kind: 'preview',
      parent,
      body: upToWord(body, b),
      ...(reasoning ? { reasoning: upToWord(reasoning, r) } : {}),
    });
  }
  return out;
}

function upToWord(text, share) {
  if (share >= 1) return text;
  let end = Math.floor(text.length * share);
  let space = text.lastIndexOf(' ', end);
  return text.slice(0, space > 0 ? space : end);
}

const LOREM =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(
    ' ',
  );

// letters become letters and digits digits, run for run, so text keeps its
// length, its line breaks and its Markdown
export function fill(text) {
  let n = 0;
  return text
    .replace(/[A-Za-zÀ-ɏ]+/g, (word) => {
      let base = LOREM[n++ % LOREM.length];
      let out = '';
      while (out.length < word.length) out += base;
      out = out.slice(0, word.length);
      return word[0] === word[0].toUpperCase() &&
        word[0] !== word[0].toLowerCase()
        ? out[0].toUpperCase() + out.slice(1)
        : out;
    })
    .replace(/[0-9]/g, '4');
}

// string leaves filled in, keys and structural values kept; a tool's
// `arguments` arrives as a JSON string and leaves as one
function fillTree(value, filler, key) {
  if (typeof value === 'string') {
    if (key === 'arguments') {
      try {
        return JSON.stringify(fillTree(JSON.parse(value), filler));
      } catch {
        return filler(value);
      }
    }
    return STRUCTURAL_KEYS.has(key) ? value : filler(value);
  }
  if (Array.isArray(value)) return value.map((v) => fillTree(v, filler));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fillTree(v, filler, k)]),
    );
  }
  return value;
}
