import {
  param,
  query,
  type DBAdapter,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  readOpenRouterModelPrice,
  type AIModelPrice,
} from '@cardstack/runtime-common/automation-ai-cost';

// The realm the OpenRouter model cards are synced into, one card per model
// OpenRouter lists, prices included.
export const OPENROUTER_MODELS_REALM = '@cardstack/openrouter/';

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

// The model's listed price, read from its indexed `OpenRouterModel` card, or
// undefined when no card lists the model or its price can't be read.
export async function openRouterModelPrice(
  dbAdapter: DBAdapter,
  modelsRealmURL: string,
  model: string,
): Promise<AIModelPrice | undefined> {
  let rows = await query(dbAdapter, [
    "SELECT pristine_doc FROM boxel_index WHERE type = 'instance' AND is_deleted IS NOT TRUE AND realm_url =",
    param(modelsRealmURL),
    "AND pristine_doc->'attributes'->>'modelId' =",
    param(model),
  ]);
  for (let row of rows) {
    let doc = (
      typeof row.pristine_doc === 'string'
        ? JSON.parse(row.pristine_doc)
        : row.pristine_doc
    ) as { attributes?: Record<string, unknown> } | null;
    let price = readOpenRouterModelPrice(doc?.attributes);
    if (price?.modelId === model) {
      return price;
    }
  }
  return undefined;
}
