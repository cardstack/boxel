// Whether this realm server submits batches of AI requests to OpenRouter's
// Batch API for automation runs (`realm.resolve.batch`). On unless
// `AI_BATCH_SUBMITS_ENABLED` is `false`, which stops new submits on a server
// without touching the batches already submitted: their follow-up runs still
// read them, and fall back to normal-price requests when they have no
// results, and the settle job still bills them.
//
// Read on each submit, so a test can turn it off for the requests it sends.
export function aiBatchSubmitsEnabled(): boolean {
  return process.env.AI_BATCH_SUBMITS_ENABLED !== 'false';
}
