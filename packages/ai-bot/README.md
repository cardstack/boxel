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

- Run Bubbleprof attached to ts-node:
  - `AI_BOT_PROF=1 DISABLE_MATRIX_JS_LOGGING=1 LOG_LEVELS="ai-bot=debug" pnpm dlx clinic bubbleprof --dest .clinic/ai-bot-bp -- node --require ts-node/register/transpile-only main.ts`
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

You can deliberately trigger a specific patch by sending a message that starts `debug:patch:` and has the JSON patch you want returned. For example:

```
debug:patch:{"attributes": {"cardId":"http://localhost:4200/experiments/Author/1", "patch": { "attributes": {"firstName": "David"}}}}
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
