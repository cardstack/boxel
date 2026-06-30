import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources';
import {
  AI_BOT_EXECUTOR,
  type CommandRequest,
} from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import {
  executeReadRealmFile,
  READ_REALM_FILE_TOOL_NAME,
  type ReadRealmFileArgs,
} from './read-realm-file.ts';
import type { DelegatedUserRealmSessionManager } from './user-delegated-realm-server-session.ts';

export interface ReadRealmFileLoopDeps {
  onBehalfOf: string;
  delegatedUserRealmSessions: Pick<
    DelegatedUserRealmSessionManager,
    'getToken' | 'invalidate'
  >;
  fetch?: typeof globalThis.fetch;
}

// Per-file result of a round, so the caller can resolve each timeline marker to
// done or failed — a read that 404s or is denied must not read as success.
export interface ReadRealmFileOutcome {
  commandRequestId: string;
  ok: boolean;
  error?: string;
}

export interface ReadRealmFileFollowup {
  // Assistant turn + one tool result per call, to append before generating
  // again. Empty when the round shouldn't loop.
  messages: ChatCompletionMessageParam[];
  // One entry per readRealmFile call that ran, in call order.
  outcomes: ReadRealmFileOutcome[];
}

export interface ClassifiedToolCalls {
  // Tool calls ai-bot runs itself, in-process, this turn (readRealmFile).
  botToolCalls: ChatCompletionMessageToolCall[];
  // Tool calls the host runs on a later turn (everything else).
  hostToolCalls: ChatCompletionMessageToolCall[];
}

// Split a completion's tool calls by who executes them. Bot tools and host
// tools have different time models — bot tools resolve same-turn, host tools
// next-turn — so the caller handles each set explicitly rather than forcing
// them through one path.
export function classifyToolCalls(
  assistantMessage: ChatCompletion.Choice['message'],
): ClassifiedToolCalls {
  let botToolCalls: ChatCompletionMessageToolCall[] = [];
  let hostToolCalls: ChatCompletionMessageToolCall[] = [];
  for (let call of assistantMessage.tool_calls ?? []) {
    if (
      call.type === 'function' &&
      call.function.name === READ_REALM_FILE_TOOL_NAME
    ) {
      botToolCalls.push(call);
    } else {
      hostToolCalls.push(call);
    }
  }
  return { botToolCalls, hostToolCalls };
}

// Runs the given bot tool calls (the `botToolCalls` from `classifyToolCalls`)
// in-process and returns the messages to append before generating again — the
// assistant turn followed by one tool result per call — plus the per-call
// outcome. The caller invokes this only when the round is bot-only; a mixed
// round is handled (rejected) by the caller without running anything here.
export async function buildReadRealmFileFollowup(
  assistantMessage: ChatCompletion.Choice['message'],
  botToolCalls: ChatCompletionMessageToolCall[],
  deps: ReadRealmFileLoopDeps,
): Promise<ReadRealmFileFollowup> {
  if (botToolCalls.length === 0) {
    return { messages: [], outcomes: [] };
  }

  let toolMessages: ChatCompletionMessageParam[] = [];
  let outcomes: ReadRealmFileOutcome[] = [];
  for (let call of botToolCalls) {
    if (call.type !== 'function') {
      continue;
    }
    let ok: boolean;
    let error: string | undefined;
    let content: string;
    let args: ReadRealmFileArgs | undefined;
    try {
      args = JSON.parse(call.function.arguments) as ReadRealmFileArgs;
    } catch {
      args = undefined;
    }
    if (!args || !args.realm || !args.url) {
      ok = false;
      error = 'readRealmFile needs a realm and a url.';
      content = `Error: ${error}`;
    } else {
      let result = await executeReadRealmFile(args, deps);
      if (result.ok) {
        ok = true;
        content = result.content;
      } else {
        ok = false;
        error = result.error;
        content = `Error: ${result.error}`;
      }
    }
    toolMessages.push({
      role: 'tool',
      tool_call_id: call.id,
      content,
    });
    outcomes.push({ commandRequestId: call.id, ok, error });
  }

  return {
    messages: [assistantMessage as ChatCompletionMessageParam, ...toolMessages],
    outcomes,
  };
}

// A short human label for a file being read, derived from its URL:
// `…/skills/<name>/SKILL.md` → `<name>/SKILL.md`, otherwise the file name.
// Shown in the timeline marker so the user sees which file was read, not a
// blank pill.
function fileLabelFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    let segments = new URL(url).pathname.split('/').filter(Boolean);
    let last = segments[segments.length - 1];
    if (last === 'SKILL.md' && segments.length >= 2) {
      return `${segments[segments.length - 2]}/SKILL.md`;
    }
    return last ?? url;
  } catch {
    return url;
  }
}

// The given bot tool calls expressed as command requests tagged
// `executedBy: 'ai-bot'`. The bot runs these in-process, so the host must not
// execute them — it surfaces them in the timeline as a record of what was read
// (and as a debugging aid when an answer looks under-informed). Used for both
// the success markers (bot-only round) and the rejection markers (mixed round).
export function readRealmFileCommandRequests(
  botToolCalls: ChatCompletionMessageToolCall[],
): Partial<CommandRequest>[] {
  return botToolCalls.map((call) => {
    let args: Record<string, any> = {};
    if (call.type === 'function') {
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        // A malformed call still gets recorded; arguments stay empty.
      }
    }
    let label = fileLabelFromUrl(args.url);
    return {
      id: call.id,
      name: READ_REALM_FILE_TOOL_NAME,
      // `description` is what the timeline command header renders; without it
      // the marker is a blank pill. The host reads it off the arguments.
      arguments: {
        ...args,
        description: label ? `Read file: ${label}` : 'Read file',
      },
      executedBy: AI_BOT_EXECUTOR,
    };
  });
}

// Content for the command-result event that resolves a file-read marker from
// its in-progress (loading) state to a terminal one. ai-bot posts one per file
// once the fetch completes; the host renders the marker as a spinner until it
// lands, then as applied (success) or invalid + the reason (failure) — the same
// applying→applied/invalid path host-run commands follow. A failed read must
// surface as failed, not as a successful read.
export function fileReadResultContent({
  commandRequestId,
  markerEventId,
  ok,
  failureReason,
  agentId,
}: {
  commandRequestId: string;
  markerEventId: string;
  ok: boolean;
  failureReason?: string;
  agentId: string | undefined;
}) {
  return {
    msgtype: APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
    commandRequestId,
    failureReason: ok ? undefined : failureReason,
    'm.relates_to': {
      event_id: markerEventId,
      key: ok ? 'applied' : 'invalid',
      rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
    },
    data: { context: { agentId } },
  };
}
