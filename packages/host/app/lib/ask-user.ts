import type MessageTool from './matrix-classes/message-tool';

// Whether a tool call is the assistant asking the user to pick (the
// `ask-user` host tool, under whatever name a skill gives it).
export function isAskUserTool(tool: Pick<MessageTool, 'name'>): boolean {
  let name = (tool.name ?? '').toLowerCase();
  return /ask[-_ ]?user/.test(name);
}
