# AI Bot

This is an experimental AI assistant for boxel using GPT4.

Applications can communicate with this via matrix chat rooms, it will automatically join any room it is invited to on the server.

Access to the matrix server currently equates to access to GPT4 if this bot is connected.

## Setup

### Matrix

This bot requires a matrix user to connect as. Create one as described in the matrix package documentation with the username `aibot` (`pnpm register-bot-user` in `packages/matrix`). The bot will default to trying to connect with the password `pass` but you can choose your own and set the `BOXEL_AIBOT_PASSWORD` environment variable.

It will default to connecting on `http://localhost:8008/`, which can be overridden with the `MATRIX_URL` environment variable.

### Boxel Development

If you are working on boxel development, you do not need to connect this up to OpenAI.

### Access to GPT4

You can get an OpenRouter api key one from the staging parameter store or ask within the team.
Set this as the `OPENROUTER_API_KEY` environment variable.

    OPENROUTER_API_KEY="sk-..."

## Running

Start the server with `pnpm start` or `pnpm start-dev` for live reload.

### Profiling (low-overhead)

- Enable lightweight phase timing logs (off by default):
  - `AI_BOT_PROF=1 LOG_LEVELS="ai-bot=debug" pnpm start`
  - Emits timings for `lock:acquire`, `history:*`, `billing:validateCredits`, `llm:request:start`, `llm:ttft`, `llm:chunk:onChunk`, `llm:finalChatCompletion`, `response:finalize`, and `title:*`.

### Async graphs (Clinic Bubbleprof)

- Run Bubbleprof attached to the node process:
  - `AI_BOT_PROF=1 DISABLE_MATRIX_JS_LOGGING=1 LOG_LEVELS="ai-bot=debug" pnpm dlx clinic bubbleprof --dest .clinic/ai-bot-bp -- node main.ts`
  - Drive one interaction; stop with Ctrl+C twice (~200–500ms apart) or send `SIGTERM` from another terminal.
  - Open the report:
    - `pnpm dlx clinic open .clinic/ai-bot-bp`
    - If needed, open the trace directly: `pnpm dlx clinic open '.clinic/ai-bot-bp/*clinic-bubbleprof/*-traceevent'`

### Streaming modes

While the model generates a response, ai-bot can surface the in-flight text so the client renders it as it arrives, instead of appearing all at once when the turn finishes. `AI_BOT_STREAMING_MODE` selects how those mid-turn updates are delivered:

- `room-edits` (default): each mid-turn update is a Matrix `m.replace` edit of the bot's placeholder message. Every connected client in the room sees the stream, and it needs no client support, but it writes many room events per response — a large share of homeserver load.
- `off`: no mid-turn updates at all. The room shows the thinking placeholder, then a single consolidated bot message when the turn completes. Cheapest for the homeserver; the client shows no streaming.
- `to-device`: mid-turn previews are sent as ephemeral [`app.boxel.response-stream`](#appboxelresponse-stream-to-device-event) to-device messages targeted at the one device that composed the prompt, and only the final consolidated state lands as a room event. Streaming UX with a fraction of the room-event churn. See the event schema below.

Regardless of mode, the final consolidated response always lands as a room event — to-device previews are ephemeral and not persisted, so durable state must live in the room.

**`to-device` fallback.** to-device previews need to know which device to target. The client stamps its device id (`matrixClient.getDeviceId()`) on the prompt event under the `app.boxel.originating-device-id` key. If ai-bot can't find that id for a turn — an older client that never stamped it, or a tool/code-patch continuation that carries no prompt — it skips mid-turn previews for that turn (as in `off`), and the final room event still lands.

### Streaming throttle tuning

Applies to `room-edits` and `to-device` mid-turn sends; `off` sends nothing mid-turn.

- `AI_BOT_STREAM_THROTTLE_MS` (default `250`): min ms between mid-turn sends.
- `AI_BOT_STREAM_MIN_DELTA` (default `0`): min new body characters before sending an update. New reasoning, a changed tool call, the first content, and the final send always go through regardless of this threshold.

### `app.boxel.response-stream` to-device event

In `to-device` streaming mode, ai-bot emits `app.boxel.response-stream` to-device messages to the originating device to carry in-flight state without writing a room event per ~250 ms of tokens. Each event carries the **full accumulated state** for the turn (not a delta), so a dropped or reordered event is non-fatal — the client applies last-writer-wins by `sequence`.

Content payload (`AppBoxelResponseStreamContent` in `packages/runtime-common/matrix-constants.ts`):

| Field           | Type        | Description                                                                                                                                                                                                    |
| --------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roomId`        | `string`    | Room the response belongs to.                                                                                                                                                                                  |
| `parentEventId` | `string`    | Event id of the thinking placeholder this stream will eventually replace. Keys the client's preview state so concurrent turns don't collide.                                                                   |
| `sequence`      | `number`    | Monotonic per turn. Since the payload is cumulative, gaps or reordering are safe — apply last-writer-wins by sequence.                                                                                         |
| `body`          | `string`    | Accumulated response text so far.                                                                                                                                                                              |
| `reasoning`     | `string`    | Accumulated reasoning text so far.                                                                                                                                                                             |
| `toolRequests`  | `unknown[]` | Tool calls in the same wire shape as the room event's `app.boxel.tool-requests` key: each entry is `{ id, name, arguments: <object> }`, where `arguments` is `{}` until the streamed tool-call JSON completes. |

### Rationale

`room-edits` mode writes a room event every throttle window of every response, which is a large share of the load on the Matrix homeserver. `off` removes that load entirely at the cost of streaming UX. `to-device` keeps the streaming UX but moves the per-window traffic onto Matrix's ephemeral direct-to-device channel, so live output reaches the originating client without every token becoming a persisted room event; only the final consolidated state is written to the room.

## Usage

Open the boxel application and go into operator mode. Click the bottom right button to launch the matrix rooms.

Once logged in, create a room and invite the aibot - it should join automatically.

It will be able to see any cards shared in the chat and can respond using GPT4 if you ask for content modifications (as a start, try 'can you create some sample data for this?'). The response should stream back and give you several options, these get applied as patches to the shared card if it is in your stack.

### Debugging

Send `debug:help` in a room the bot has joined to list the available debug commands.

`debug:eventlist` attaches a JSON dump of the room's events. Streamed messages show their final content: `m.replace` edits are applied and continuation-split messages are joined, so each message body matches what the model sees when the prompt is constructed. Use `debug:eventlist:raw` for the unaggregated timeline, where streamed messages appear as their original placeholder events with edits nested under `unsigned["m.relations"]["m.replace"]`.

`debug:prompt` attaches the prompt that would be sent to the AI for the last user message. Append a number, e.g. `debug:prompt:3`, to drop that many trailing events first.

You can deliberately trigger a specific patch by sending a message that starts `debug:patch:` and has the JSON patch you want returned. For example:

```
debug:patch:{"attributes": {"cardId":"https://localhost:4200/experiments/Author/1", "patch": { "attributes": {"firstName": "David"}}}}
```

This will return a patch with the ID of the last card you uploaded. This does not hit GPT4 and is useful for testing the integration of the two components without waiting for streaming responses.

You can set a room name with `debug:title:set:`

```
debug:title:set:My Room
```

And you can trigger room naming with `debug:title:create` on its own.

## Testing

### Unit tests

Run `pnpm test`
