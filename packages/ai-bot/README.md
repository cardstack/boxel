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

### Streaming behavior tuning

- You can adjust mid-stream edit frequency to balance responsiveness vs. Matrix churn:
  - `AI_BOT_STREAM_THROTTLE_MS` (default `600`): min ms between edit sends.
  - `AI_BOT_STREAM_MIN_DELTA` (default `300`): min new characters before sending an edit (final send always occurs).

## Usage

Open the boxel application and go into operator mode. Click the bottom right button to launch the matrix rooms.

Once logged in, create a room and invite the aibot - it should join automatically.

It will be able to see any cards shared in the chat and can respond using GPT4 if you ask for content modifications (as a start, try 'can you create some sample data for this?'). The response should stream back and give you several options, these get applied as patches to the shared card if it is in your stack.

### Debugging

Send `boxel-debug` in a room the bot has joined to list the available debug commands. The bot answers these messages itself; they never reach the model.

`boxel-debug:feature:enable:<name>` enables a skill feature for that room, from the next message, and `boxel-debug:feature:disable:<name>` disables it again. A skill feature is a section of a skill file between `<!-- feature:<name> -->` and `<!-- /feature:<name> -->`; the bot leaves it out of the prompt unless the room enabled it. For example, `boxel-debug:feature:enable:catalog-reuse` turns on the mandatory catalog search in the skills index. `boxel-debug:feature` lists the features enabled in the room. The features a room can enable, with what each does, are listed in `SKILL_FEATURES` in `packages/runtime-common/ai/debug.ts`; a new marker name in a skill file must be added there too.

A message that looks like one of the old `debug:` commands gets a reply that points to `boxel-debug`, and does not reach the model.

`boxel-debug:eventlist` attaches a JSON dump of the room's events. Streamed messages show their final content: `m.replace` edits are applied and continuation-split messages are joined, so each message body matches what the model sees when the prompt is constructed. Use `boxel-debug:eventlist:raw` for the unaggregated timeline, where streamed messages appear as their original placeholder events with edits nested under `unsigned["m.relations"]["m.replace"]`.

`boxel-debug:prompt` attaches the prompt that would be sent to the AI for the last user message. Append a number, e.g. `boxel-debug:prompt:3`, to drop that many trailing events first.

You can deliberately trigger a specific patch by sending a message that starts `boxel-debug:patch:` and has the JSON patch you want returned. For example:

```
boxel-debug:patch:{"attributes": {"cardId":"https://localhost:4200/experiments/Author/1", "patch": { "attributes": {"firstName": "David"}}}}
```

This will return a patch with the ID of the last card you uploaded. This does not hit GPT4 and is useful for testing the integration of the two components without waiting for streaming responses.

You can set a room name with `boxel-debug:title:set:`

```
boxel-debug:title:set:My Room
```

And you can trigger room naming with `boxel-debug:title:create` on its own.

## Testing

### Unit tests

Run `pnpm test`
