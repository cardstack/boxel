export const thinkingMessage = 'Thinking...';

// Shown when the provider stops a generation at its maximum output-token
// limit (finish_reason 'length'): the answer is cut off, not withdrawn, so
// the partial content stays in the room and this rides alongside it.
export const maxOutputTokensErrorMessage =
  'The response reached the maximum output length before it could finish. Ask the assistant to continue, or break the request into smaller steps.';

// Shown instead of maxOutputTokensErrorMessage when the cut landed inside a
// readRealmFile call that still named at least one complete url: the bot
// reads those files and re-prompts the model on its own, so asking the user
// to "ask the assistant to continue" would ask for what is already happening.
export const maxOutputTokensDuringFileReadErrorMessage =
  'The response reached the maximum output length while it was listing files to read. The list was trimmed to the files it had already named; those are being read now and the assistant continues on its own.';
