export const thinkingMessage = 'Thinking...';

// Final message content when a generation completes with neither text nor
// tool calls (e.g. the model spends its whole turn on reasoning and stops).
// Publishing the raw empty completion renders a blank message and leaves no
// signal — for the user or for the model's own next-turn history — that
// anything went wrong.
export const emptyResponseFallbackMessage =
  "I wasn't able to produce a response for that. Please try again, or rephrase your request.";
