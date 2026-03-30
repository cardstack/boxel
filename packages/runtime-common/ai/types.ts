import type {
  BoxelContext,
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
} from '@cardstack/base/matrix-event';
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
export type ImageContentPart = {
  type: 'image_url';
  image_url: {
    url: string; // URL or base64 encoded image data
    detail?: string; // Optional, defaults to "auto"
  };
  cache_control?: {
    type: 'ephemeral';
  };
};
export type FileContentPart = {
  type: 'file';
  file: {
    filename: string;
    file_data: string; // base64 data URL (data:application/pdf;base64,...) or public URL
  };
  cache_control?: {
    type: 'ephemeral';
  };
};
export type InputAudioContentPart = {
  type: 'input_audio';
  input_audio: {
    data: string; // raw base64 string (no data: prefix)
    format: string; // wav | mp3 | aiff | aac | ogg | flac | m4a | pcm16 | pcm24
  };
  cache_control?: {
    type: 'ephemeral';
  };
};
export type VideoContentPart = {
  type: 'video_url';
  video_url: {
    url: string; // base64 data URL or public URL
  };
  cache_control?: {
    type: 'ephemeral';
  };
};
export type ContentPart =
  | TextContent
  | ImageContentPart
  | FileContentPart
  | InputAudioContentPart
  | VideoContentPart;

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
