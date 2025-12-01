export type SimpleMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export function prettifyMessages(messages: SimpleMessage[]): string {
  let header = '=== LLM Request Messages ===';
  let parts: string[] = [];
  parts.push(header);
  messages.forEach((message, index) => {
    let label = `-- Message ${index + 1} (${message.role}) --`;
    let content =
      typeof message.content === 'string'
        ? message.content
        : String(message.content);
    parts.push(label);
    parts.push(content.trimEnd());
  });
  parts.push('=== END LLM Request Messages ===');
  return parts.join('\n\n');
}
