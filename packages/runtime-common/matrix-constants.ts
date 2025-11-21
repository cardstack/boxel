export const APP_BOXEL_STOP_GENERATING_EVENT_TYPE = 'app.boxel.stopGenerating';
export const APP_BOXEL_MESSAGE_MSGTYPE = 'app.boxel.message';
export const APP_BOXEL_CARD_FORMAT = 'app.boxel.card';
export const APP_BOXEL_COMMAND_REQUESTS_KEY = 'app.boxel.commandRequests';
export const APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE =
  'app.boxel.codePatchResult';
export const APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE = 'app.boxel.codePatchResult';
export const APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE =
  'app.boxel.codePatchAnnotation';
export const APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE =
  'app.boxel.codePatchCorrectness';
export const APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE =
  'app.boxel.codePatchCorrectnessAnnotation';
export const APP_BOXEL_COMMAND_RESULT_EVENT_TYPE = 'app.boxel.commandResult';
export const APP_BOXEL_COMMAND_RESULT_REL_TYPE = 'app.boxel.commandAnnotation';
export const APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE =
  'app.boxel.commandResultWithOutput';
export const APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE =
  'app.boxel.commandResultWithNoOutput';
export const APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE = 'app.boxel.debug';
export const APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE =
  'app.boxel.realm-server-event';
export const APP_BOXEL_ROOM_SKILLS_EVENT_TYPE = 'app.boxel.room.skills';
export const APP_BOXEL_REALMS_EVENT_TYPE = 'app.boxel.realms';
export const APP_BOXEL_SYSTEM_CARD_EVENT_TYPE = 'app.boxel.system-card';
export const APP_BOXEL_REALM_EVENT_TYPE = 'app.boxel.realm-event';
export const APP_BOXEL_ACTIVE_LLM = 'app.boxel.active-llm';
export const APP_BOXEL_REASONING_CONTENT_KEY = 'app.boxel.reasoning';
export const APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY =
  'app.boxel.has-continuation';
export const APP_BOXEL_CONTINUATION_OF_CONTENT_KEY =
  'app.boxel.continuation-of';
export const APP_BOXEL_LLM_MODE = 'app.boxel.llm-mode';
export type LLMMode = 'ask' | 'act';
export const DEFAULT_LLM = 'anthropic/claude-sonnet-4.5';
export const DEFAULT_CODING_LLM = 'anthropic/claude-sonnet-4.5';
export const DEFAULT_REMIX_LLM = 'openai/gpt-5-nano';

export const DEFAULT_LLM_ID_TO_NAME: Record<string, string> = {
  'anthropic/claude-3.5-sonnet': 'Anthropic: Claude 3.5 Sonnet',
  'anthropic/claude-3.7-sonnet': 'Anthropic: Claude 3.7 Sonnet',
  'anthropic/claude-3.7-sonnet:thinking':
    'Anthropic: Claude 3.7 Sonnet (thinking)',
  'anthropic/claude-haiku-4.5': 'Anthropic: Claude Haiku 4.5',
  'anthropic/claude-sonnet-4': 'Anthropic: Claude Sonnet 4',
  'anthropic/claude-sonnet-4.5': 'Anthropic: Claude Sonnet 4.5',
  'anthropic/claude-opus-4.1': 'Anthropic: Claude Opus 4.1',
  'deepseek/deepseek-chat-v3-0324': 'DeepSeek: DeepSeek V3 0324',
  'google/gemini-2.5-pro': 'Google: Gemini 2.5 Pro',
  'google/gemini-2.5-flash-lite': 'Google: Gemini 2.5 Flash Lite',
  'google/gemini-2.5-flash': 'Google: Gemini 2.5 Flash',
  'meta-llama/llama-3.2-3b-instruct': 'Meta: Llama 3.2 3B Instruct',
  'openai/gpt-4.1-nano': 'OpenAI: GPT-4.1 Nano',
  'openai/gpt-4.1-mini': 'OpenAI: GPT-4.1 Mini',
  'openai/gpt-4.1': 'OpenAI: GPT-4.1',
  'openai/gpt-4o': 'OpenAI: GPT-4o',
  'openai/gpt-4o-mini': 'OpenAI: GPT-4o-mini',
  'openai/gpt-5-nano': 'OpenAI: GPT-5 Nano',
  'openai/gpt-5-mini': 'OpenAI: GPT-5 Mini',
  'openai/gpt-5': 'OpenAI: GPT-5',
  'openai/gpt-oss-20b': 'OpenAI: GPT OSS 20B',
};

// Note - we are moving towards using the system card for defining these for users
// See:
// - packages/catalog-realm/ModelConfiguration for a list of models for all users
// - packages/catalog-realm/SystemCard/default.json for the default system card for users
// - packages/host/README.md for how to add new models
export const DEFAULT_LLM_LIST = Object.keys(DEFAULT_LLM_ID_TO_NAME);

export const SLIDING_SYNC_AI_ROOM_LIST_NAME = 'ai-room';
export const SLIDING_SYNC_AUTH_ROOM_LIST_NAME = 'auth-room';
export const SLIDING_SYNC_LIST_RANGE_END = 9;
export const SLIDING_SYNC_LIST_TIMELINE_LIMIT = 1;
export const SLIDING_SYNC_TIMEOUT = 30000;
