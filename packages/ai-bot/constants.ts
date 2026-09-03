export const thinkingMessage = 'Thinking...';

// Shown when the provider stops a generation at its maximum output-token
// limit (finish_reason 'length'): the answer is cut off, not withdrawn, so
// the partial content stays in the room and this rides alongside it.
export const maxOutputTokensErrorMessage =
  'The response reached the maximum output length before it could finish. Ask the assistant to continue, or break the request into smaller steps.';
