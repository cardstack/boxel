import type {
  BoxelContext,
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
} from 'https://cardstack.com/base/matrix-event';
import type { ReasoningEffort } from 'openai/resources/shared';
import type { ToolChoice } from '../helpers/ai';
import type { CardResource } from '../resource-types';

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
  pendingCodePatchCorrectnessChecks?: PendingCodePatchCorrectnessCheck;
}

export type TextContent = {
  type: 'text';
  text: string;
  cache_control?: {
    type: 'ephemeral';
  };
};
type ImageContentPart = {
  type: 'image_url';
  image_url: {
    url: string; // URL or base64 encoded image data
    detail?: string; // Optional, defaults to "auto"
  };
  cache_control?: {
    type: 'ephemeral';
  };
};
type ContentPart = TextContent | ImageContentPart;

export interface OpenAIPromptMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  name?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
  tool_call_id?: string;
}

export interface RelevantCards {
  mostRecentlyAttachedCard: CardResource | undefined;
  attachedCards: CardResource[];
}

export interface CodePatchCorrectnessFile {
  sourceUrl: string;
  displayName: string;
  lintIssues?: string[];
}

export interface CodePatchCorrectnessCard {
  cardId: string;
}

export interface PendingCodePatchCorrectnessCheck {
  targetEventId: string;
  roomId: string;
  context?: BoxelContext;
  files: CodePatchCorrectnessFile[];
  cards: CodePatchCorrectnessCard[];
  attemptsByTargetKey?: Record<string, number>;
}

export class HistoryConstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryConstructionError';
  }
}
