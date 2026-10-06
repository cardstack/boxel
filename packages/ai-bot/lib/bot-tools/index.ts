import type {
  ChatCompletion,
  ChatCompletionMessageToolCall,
} from 'openai/resources';
import { readRealmFileBotTool } from './read-realm-file/index.ts';
import { readUrlBotTool } from './read-url/index.ts';
import type {
  BotTool,
  BotToolRoom,
  BotToolRoomFacts,
  BotToolTurn,
} from './types.ts';

export type * from './types.ts';

// Every tool ai-bot runs itself, in the order their calls are fulfilled.
export const BOT_TOOLS: readonly BotTool[] = [
  readRealmFileBotTool,
  readUrlBotTool,
];

export function botToolNamed(name: string | undefined): BotTool | undefined {
  return BOT_TOOLS.find((tool) => tool.name === name);
}

export function offeredBotTools(room: BotToolRoomFacts): BotTool[] {
  return BOT_TOOLS.filter((tool) => tool.isOffered(room));
}

// Each offered tool's state for this handler run, by tool name.
export async function startBotToolTurns(
  tools: BotTool[],
  room: Omit<BotToolRoom, 'offeredToolNames'>,
): Promise<Map<string, BotToolTurn>> {
  let offeredToolNames = new Set(tools.map((tool) => tool.name));
  let turns = await Promise.all(
    tools.map(
      async (tool) =>
        [
          tool.name,
          await tool.startTurn({ ...room, offeredToolNames }),
        ] as const,
    ),
  );
  return new Map(turns);
}

export interface ClassifiedToolCalls {
  // Tool calls ai-bot runs itself (see BOT_TOOLS).
  botToolCalls: ChatCompletionMessageToolCall[];
  // Tool calls the host runs (everything else).
  hostToolCalls: ChatCompletionMessageToolCall[];
}

// Split a completion's tool calls into the ones ai-bot fulfills itself and
// the ones the host fulfills. Both kinds resolve the same way — as command
// requests answered by a command-result event on a later turn — so a single
// response may freely contain both; the caller fulfills the bot ones and
// leaves the rest to the host.
export function classifyToolCalls(
  assistantMessage: ChatCompletion.Choice['message'],
): ClassifiedToolCalls {
  let botToolCalls: ChatCompletionMessageToolCall[] = [];
  let hostToolCalls: ChatCompletionMessageToolCall[] = [];
  for (let call of assistantMessage.tool_calls ?? []) {
    if (call.type === 'function' && botToolNamed(call.function.name)) {
      botToolCalls.push(call);
    } else {
      hostToolCalls.push(call);
    }
  }
  return { botToolCalls, hostToolCalls };
}

// True when a cut-off response's tool calls include a bot-tool call that
// still names enough to run, so the bot carries on by itself.
export function hasRecoverableBotToolCall(
  toolCalls: { function?: { name?: string; arguments?: string } }[],
): boolean {
  return toolCalls.some(
    (toolCall) =>
      botToolNamed(toolCall?.function?.name)?.recoversFromCutOff?.(
        toolCall.function?.arguments ?? '',
      ) ?? false,
  );
}
