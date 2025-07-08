export const APP_BOXEL_STOP_GENERATING_EVENT_TYPE = 'app.boxel.stopGenerating';
export const APP_BOXEL_MESSAGE_MSGTYPE = 'app.boxel.message';
export const APP_BOXEL_CARD_FORMAT = 'app.boxel.card';
export const APP_BOXEL_COMMAND_REQUESTS_KEY = 'app.boxel.commandRequests';
export const APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE =
  'app.boxel.codePatchResult';
export const APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE = 'app.boxel.codePatchResult';
export const APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE =
  'app.boxel.codePatchAnnotation';
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
export const APP_BOXEL_REALM_EVENT_TYPE = 'app.boxel.realm-event';
export const APP_BOXEL_ACTIVE_LLM = 'app.boxel.active-llm';
export const APP_BOXEL_REASONING_CONTENT_KEY = 'app.boxel.reasoning';
export const APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY =
  'app.boxel.has-continuation';
export const APP_BOXEL_CONTINUATION_OF_CONTENT_KEY =
  'app.boxel.continuation-of';
export const DEFAULT_LLM = 'openai/gpt-4.1';
export const DEFAULT_CODING_LLM = 'anthropic/claude-sonnet-4';
export const DEFAULT_REMIX_LLM = 'openai/gpt-4.1-nano';

export const DEFAULT_LLM_ID_TO_NAME: Record<string, string> = {
  'anthropic/claude-3.5-sonnet': 'Anthropic: Claude 3.5 Sonnet',
  'anthropic/claude-3.7-sonnet': 'Anthropic: Claude 3.7 Sonnet',
  'anthropic/claude-3.7-sonnet:thinking':
    'Anthropic: Claude 3.7 Sonnet (thinking)',
  'anthropic/claude-sonnet-4': 'Anthropic: Claude Sonnet 4',
  'anthropic/claude-opus-4': 'Anthropic: Claude Opus 4',
  'deepseek/deepseek-chat-v3-0324': 'DeepSeek: DeepSeek V3 0324',
  'google/gemini-2.0-flash-001': 'Google: Gemini 2.0 Flash',
  'google/gemini-2.0-flash-lite-001': 'Google: Gemini 2.0 Flash Lite',
  'google/gemini-2.5-pro-preview': 'Google: Gemini 2.5 Pro Preview 06-05',
  'meta-llama/llama-3.2-3b-instruct': 'Meta: Llama 3.2 3B Instruct',
  'openai/gpt-4.1-nano': 'OpenAI: GPT-4.1 Nano',
  'openai/gpt-4.1-mini': 'OpenAI: GPT-4.1 Mini',
  'openai/gpt-4.1': 'OpenAI: GPT-4.1',
  'openai/gpt-4o': 'OpenAI: GPT-4o',
  'openai/gpt-4o-mini': 'OpenAI: GPT-4o-mini',
};

export const DEFAULT_LLM_LIST = Object.keys(DEFAULT_LLM_ID_TO_NAME);

export const SLIDING_SYNC_AI_ROOM_LIST_NAME = 'ai-room';
export const SLIDING_SYNC_AUTH_ROOM_LIST_NAME = 'auth-room';
export const SLIDING_SYNC_LIST_RANGE_END = 9;
export const SLIDING_SYNC_LIST_TIMELINE_LIMIT = 1;
export const SLIDING_SYNC_TIMEOUT = 30000;
