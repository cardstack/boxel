import {
  CREDITS_PER_USD,
  param,
  query,
  type DBAdapter,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  aiRequestCostCeiling,
  readOpenRouterModelPrice,
  type AIModelPrice,
  type AIRequestCostRefusal,
} from '@cardstack/runtime-common/automation-ai-cost';

// The realm the OpenRouter model cards are synced into, one card per model
// OpenRouter lists, prices included.
export const OPENROUTER_MODELS_REALM = '@cardstack/openrouter/';

// The suffix OpenRouter lists a model's batch price under: the batch listing
// of `anthropic/claude-sonnet-4.6` is `anthropic/claude-sonnet-4.6:batch`.
const BATCH_LISTING_SUFFIX = ':batch';

// What a batch can cost, worked out before it is submitted. OpenRouter
// reports a batch's cost only once it ends, and only for one that completed,
// and gives no estimate when it accepts one, so this estimate is what an
// expired batch with no reported cost is billed at (ADR 030 §1.4).
//
// Each request is priced at its worst case (`aiRequestCostCeiling`: its body's
// bytes as input tokens and its output-token limit) at the model's listed
// batch price. A model OpenRouter lists no batch price for is priced at its
// listed price, which a batch never costs more than. The listing read is the
// model's base rates: a model whose rates rise above a prompt-length threshold
// (OpenRouter's `pricing.overrides`, which the model sync doesn't keep) can
// cost more than this for a request long enough to cross it.
export interface AIBatchEstimate {
  usd: number;
  // The listing the requests were priced at: the model's batch listing, or
  // the model itself when it has none.
  pricedAs: string;
}

export type AIBatchEstimateResult =
  | {
      ok: true;
      estimate: AIBatchEstimate;
      // The model's own listed price, which a run's AI spending cap counts
      // batched requests against (ADR 030 §1.4).
      listedPrice: AIModelPrice;
    }
  | {
      ok: false;
      // `unknown-model`: the model has no listing, or one whose price can't
      // be read. An `AIRequestCostRefusal`: a request whose worst case can't
      // be priced.
      reason: 'unknown-model' | AIRequestCostRefusal;
      message: string;
    };

export async function estimateAIBatch(
  dbAdapter: DBAdapter,
  modelsRealmURL: string,
  model: string,
  requestBodies: string[],
): Promise<AIBatchEstimateResult> {
  let { listed, batch } = await listedPrices(dbAdapter, modelsRealmURL, model);
  // The model's own listing is required even when it has a batch listing:
  // the run's cap counts each batched request at the normal price.
  if (!listed) {
    return {
      ok: false,
      reason: 'unknown-model',
      message: `Boxel has no listed price for the model ${model}, so it can't send a batch to it`,
    };
  }
  // A request names the model itself, never its batch listing, so the batch
  // listing's rates are priced under the model's own id.
  let price: AIModelPrice = batch ? { ...batch, modelId: model } : listed;
  let usd = 0;
  for (let [index, body] of requestBodies.entries()) {
    let priced = aiRequestCostCeiling(body, price);
    if (!priced.ok) {
      return {
        ok: false,
        reason: priced.reason,
        message: `Request ${index + 1} of the batch: ${priced.message}`,
      };
    }
    // The record keeps USD, the unit OpenRouter reports a batch's cost in.
    usd += priced.ceiling.credits / CREDITS_PER_USD;
  }
  return {
    ok: true,
    estimate: { usd, pricedAs: batch ? batch.modelId : model },
    listedPrice: listed,
  };
}

// The model's own listing and its batch listing, read from the indexed
// OpenRouter model cards. A listing whose price can't be read counts as no
// listing.
async function listedPrices(
  dbAdapter: DBAdapter,
  modelsRealmURL: string,
  model: string,
): Promise<{ listed?: AIModelPrice; batch?: AIModelPrice }> {
  let batchListing = `${model}${BATCH_LISTING_SUFFIX}`;
  let rows = await query(dbAdapter, [
    "SELECT pristine_doc FROM boxel_index WHERE type = 'instance' AND is_deleted IS NOT TRUE AND realm_url =",
    param(modelsRealmURL),
    "AND pristine_doc->'attributes'->>'modelId' IN (",
    param(batchListing),
    ',',
    param(model),
    ')',
  ]);
  let prices = new Map<string, AIModelPrice>();
  for (let row of rows) {
    let doc = (
      typeof row.pristine_doc === 'string'
        ? JSON.parse(row.pristine_doc)
        : row.pristine_doc
    ) as { attributes?: Record<string, unknown> } | null;
    let price = readOpenRouterModelPrice(doc?.attributes);
    if (price) {
      prices.set(price.modelId, price);
    }
  }
  return { listed: prices.get(model), batch: prices.get(batchListing) };
}

// The URL the OpenRouter model cards are indexed under on this server, or
// undefined when it doesn't mount that realm.
export function openRouterModelsRealmURL(
  virtualNetwork: VirtualNetwork,
): string | undefined {
  if (!virtualNetwork.isRegisteredPrefix(OPENROUTER_MODELS_REALM)) {
    return undefined;
  }
  return virtualNetwork.toURL(OPENROUTER_MODELS_REALM).href;
}
