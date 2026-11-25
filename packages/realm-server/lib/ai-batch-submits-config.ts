// Whether this realm server submits batches of AI requests to OpenRouter's
// Batch API for automation runs (`realm.resolve.batch`). Off unless
// `AI_BATCH_SUBMITS_ENABLED` is `true`. A submitted batch is picked up by its
// follow-up run, which falls back to normal-price requests when the batch
// misses its deadline, so a server turns submits on only where that
// follow-up is in place. Reads of batches already submitted, and the settle
// job that bills them, don't depend on it.
//
// Read on each submit, so a test can turn it on for the requests it sends.
export function aiBatchSubmitsEnabled(): boolean {
  return process.env.AI_BATCH_SUBMITS_ENABLED === 'true';
}
