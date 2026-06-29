import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from 'openai/resources';
import {
  executeLoadSkill,
  LOAD_SKILL_TOOL_NAME,
  type LoadSkillArgs,
} from './load-skill.ts';
import type { DelegatedUserRealmSessionManager } from './user-delegated-realm-server-session.ts';

export interface LoadSkillLoopDeps {
  onBehalfOf: string;
  delegatedUserRealmSessions: Pick<
    DelegatedUserRealmSessionManager,
    'getToken' | 'invalidate'
  >;
  fetch?: typeof globalThis.fetch;
}

// Decides what happens after a generation round given the assistant message it
// produced. When that message's tool calls are exclusively `loadSkill`, runs
// them and returns the messages to append before generating again — the
// assistant turn followed by one tool result per call. Returns an empty array
// in every other case (no tool calls, or a mix that includes host-dispatched
// commands), which tells the caller to stop looping and let the answer stand.
export async function buildLoadSkillFollowup(
  assistantMessage: ChatCompletion.Choice['message'],
  deps: LoadSkillLoopDeps,
): Promise<ChatCompletionMessageParam[]> {
  let toolCalls = assistantMessage.tool_calls ?? [];
  if (toolCalls.length === 0) {
    return [];
  }

  let loadSkillCalls = toolCalls.filter(
    (call) =>
      call.type === 'function' && call.function.name === LOAD_SKILL_TOOL_NAME,
  );
  // Only the bot's own tool was called this round — anything else (a
  // host-dispatched command) means the turn is doing more than loading skills,
  // so leave it to the normal command-request path rather than re-prompting.
  if (
    loadSkillCalls.length === 0 ||
    loadSkillCalls.length !== toolCalls.length
  ) {
    return [];
  }

  let toolMessages: ChatCompletionMessageParam[] = [];
  for (let call of loadSkillCalls) {
    if (call.type !== 'function') {
      continue;
    }
    let content: string;
    let args: LoadSkillArgs | undefined;
    try {
      args = JSON.parse(call.function.arguments) as LoadSkillArgs;
    } catch {
      args = undefined;
    }
    if (!args || !args.realm || !args.name) {
      content = 'Error: loadSkill needs a realm and a skill name.';
    } else {
      let result = await executeLoadSkill(args, deps);
      content = result.ok ? result.content : `Error: ${result.error}`;
    }
    toolMessages.push({
      role: 'tool',
      tool_call_id: call.id,
      content,
    });
  }

  return [assistantMessage as ChatCompletionMessageParam, ...toolMessages];
}
