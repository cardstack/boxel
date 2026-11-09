import type MessageTool from './matrix-classes/message-tool';

// `ask-user`, `ask_user`, `AskUserTool`, with the hash suffix a tool name
// carries (`AskUserTool_3eed`); `assignTaskUser` is not one.
const ASK_USER_NAME = /^ask[-_ ]?user(?:[-_ ]?tool)?(?:_[a-z0-9]{4})?$/;

// Whether a tool call is the assistant asking the user to pick (the
// `ask-user` host tool, under whatever name a skill gives it).
export function isAskUserTool(tool: Pick<MessageTool, 'name'>): boolean {
  return ASK_USER_NAME.test((tool.name ?? '').toLowerCase());
}
