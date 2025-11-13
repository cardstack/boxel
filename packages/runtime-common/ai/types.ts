import type {
  BoxelContext,
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
} from 'https://cardstack.com/base/matrix-event';
import type { ReasoningEffort } from 'openai/resources/shared';
import type { LooseCardResource } from '../index';
import type { ToolChoice } from '../helpers/ai';

export interface ChatCompletionMessageToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
  type: 'function';
}

export interface PromptParts {
  messages: OpenAIPromptMessage[] | undefined;
  tools: Tool[] | undefined;
  toolChoice: ToolChoice | undefined;
  model: string | undefined;
  toolsSupported?: boolean;
  reasoningEffort?: ReasoningEffort;
  shouldRespond: boolean;
  history: DiscreteMatrixEvent[];
  pendingPatchSummary?: PendingPatchSummary;
}

export interface OpenAIPromptMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
  tool_call_id?: string;
}

export interface RelevantCards {
  mostRecentlyAttachedCard: LooseCardResource | undefined;
  attachedCards: LooseCardResource[];
}

export interface PatchSummaryFile {
  sourceUrl: string;
  displayName: string;
}

export interface PatchSummaryCard {
  cardId: string;
}

export interface PendingPatchSummary {
  targetEventId: string;
  roomId: string;
  context?: BoxelContext;
  files: PatchSummaryFile[];
  cards: PatchSummaryCard[];
}

export class HistoryConstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryConstructionError';
  }
}
