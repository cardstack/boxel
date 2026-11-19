import {
  type DBAdapter,
  type SpendCharge,
  MINIMUM_AI_CREDITS_TO_CONTINUE,
  logger,
} from '@cardstack/runtime-common';
import {
  validateAICredits,
  spendUsageCost as spendUsageCostFromBilling,
  fetchGenerationCostWithBackoff,
  type GenerationCostLookupOptions,
} from '@cardstack/billing/ai-billing';
import {
  OutboundRefusedError,
  OutboundResponseTooLargeError,
  outboundFetch,
} from './outbound/client.ts';

const log = logger('credit-strategies');

// What an AI call's spend paid for. Without a run it is the call alone; a call
// an automation run makes names the run and its realm.
export type AICallCharge = Extract<SpendCharge, { kind: 'ai' }>;

// The cost lookup sends the system key, so it goes out through the guarded
// outbound client like every other call that does. The client attaches the key
// itself, under the name of the endpoint it belongs to, so the Authorization
// header the billing lookup builds is left off. A refused destination, and an
// answer over the size cap, are refused the same way on every attempt, so
// neither is retried.
function guardedCostLookup(
  apiKey: string,
  keyName: string,
  responseSizeCap: number | undefined,
): GenerationCostLookupOptions {
  return {
    fetch: (url, { headers }) =>
      outboundFetch({
        url,
        method: 'GET',
        headers: Object.fromEntries(
          Object.entries(headers).filter(
            ([name]) => name.toLowerCase() !== 'authorization',
          ),
        ),
        sizePath: 'system-key',
        responseSizeCap,
        destinationSetBy: 'platform',
        credential: {
          name: keyName,
          value: apiKey,
          placement: {
            in: 'header',
            header: 'Authorization',
            scheme: 'Bearer',
          },
        },
      }),
    isRetryable: (error) =>
      !(
        error instanceof OutboundRefusedError ||
        error instanceof OutboundResponseTooLargeError
      ),
  };
}

export interface CreditStrategy {
  name: string;
  // Whether a call's cost is read from what the upstream sends back. When it
  // is not, a proxy forwards the response without looking for usage in it,
  // and a call whose client leaves is cancelled rather than read to the end.
  chargesForUsage: boolean;
  validateCredits(
    dbAdapter: DBAdapter,
    matrixUserId: string,
  ): Promise<{
    hasEnoughCredits: boolean;
    availableCredits: number;
    errorMessage?: string;
  }>;
  // What an upstream response cost in USD, or undefined when it cannot be
  // determined. This can take minutes — it may poll the provider for a cost
  // the response did not carry — so it runs outside the user's cost lock.
  resolveUsageCost(
    matrixUserId: string,
    response: any,
  ): Promise<number | undefined>;
  // Records `costInUsd` against the user's credits, as `charge` (an AI call
  // with no reference when it is omitted). The ledger write reads the balance
  // of each credit bucket before debiting it, so callers hold the user's cost
  // lock around this.
  spendUsageCost(
    dbAdapter: DBAdapter,
    matrixUserId: string,
    costInUsd: number,
    charge?: AICallCharge,
  ): Promise<void>;
}

// Default AI Bot Credit Strategy (reused from AI bot)
export class OpenRouterCreditStrategy implements CreditStrategy {
  name = 'openrouter-credit-strategy';
  chargesForUsage = true;
  openRouterApiKey: string;
  // How logs and errors name the key: its proxy endpoint's system key name.
  keyName: string;
  // The key's own response size cap, which the cost lookup is held to too.
  responseSizeCap: number | undefined;

  constructor(
    openRouterApiKey: string,
    keyName: string,
    responseSizeCap?: number,
  ) {
    this.openRouterApiKey = openRouterApiKey;
    this.keyName = keyName;
    this.responseSizeCap = responseSizeCap;
  }

  async validateCredits(dbAdapter: DBAdapter, matrixUserId: string) {
    const result = await validateAICredits(dbAdapter, matrixUserId);

    if (!result.hasEnoughCredits) {
      return {
        ...result,
        errorMessage: `You need a minimum of ${MINIMUM_AI_CREDITS_TO_CONTINUE} credits to continue. Please upgrade to a larger plan, or top up your account.`,
      };
    }

    return result;
  }

  async resolveUsageCost(
    matrixUserId: string,
    response: any,
  ): Promise<number | undefined> {
    const costInUsd = response?.usage?.cost;
    if (
      typeof costInUsd === 'number' &&
      Number.isFinite(costInUsd) &&
      costInUsd > 0
    ) {
      return costInUsd;
    }

    const generationId = response?.id;
    if (generationId) {
      log.info(
        `No inline cost for user ${matrixUserId}, falling back to generation cost API (generationId: ${generationId})`,
      );
      const fetchedCost = await fetchGenerationCostWithBackoff(
        generationId,
        this.openRouterApiKey,
        guardedCostLookup(
          this.openRouterApiKey,
          this.keyName,
          this.responseSizeCap,
        ),
      );
      if (fetchedCost !== null) {
        return fetchedCost;
      }
      log.warn(
        `Failed to fetch generation cost for user ${matrixUserId} (generationId: ${generationId}), credit deduction skipped`,
      );
      return undefined;
    }
    log.warn(
      `No usage cost and no generation ID in response for user ${matrixUserId}, skipping credit deduction`,
    );
    return undefined;
  }

  async spendUsageCost(
    dbAdapter: DBAdapter,
    matrixUserId: string,
    costInUsd: number,
    charge?: AICallCharge,
  ): Promise<void> {
    await spendUsageCostFromBilling(dbAdapter, matrixUserId, costInUsd, charge);
  }
}

// No Credit Strategy (for free endpoints)
export class NoCreditStrategy implements CreditStrategy {
  name = 'no-credit-strategy';
  chargesForUsage = false;

  async validateCredits(_dbAdapter: DBAdapter, _matrixUserId: string) {
    return {
      hasEnoughCredits: true,
      availableCredits: 0,
    };
  }

  async resolveUsageCost(
    _matrixUserId: string,
    _response: any,
  ): Promise<number | undefined> {
    return undefined;
  }

  async spendUsageCost(
    _dbAdapter: DBAdapter,
    _matrixUserId: string,
    _costInUsd: number,
    _charge?: AICallCharge,
  ): Promise<void> {
    // No-op for no-credit strategy
  }
}

// Credit Strategy Factory
export class CreditStrategyFactory {
  // `keyName` is how the endpoint's system key is named in logs and errors
  // (see `systemKeyName`), and `responseSizeCap` the key's own response size
  // cap, when it has one.
  static create(
    strategyType: string,
    apiKey: string | undefined,
    keyName: string,
    responseSizeCap?: number,
  ): CreditStrategy {
    switch (strategyType) {
      case 'openrouter':
        if (!apiKey) {
          throw new Error('API key is required for OpenRouter credit strategy');
        }
        return new OpenRouterCreditStrategy(apiKey, keyName, responseSizeCap);
      case 'no-credit':
        return new NoCreditStrategy();
      default:
        throw new Error(`Unknown credit strategy: ${strategyType}`);
    }
  }
}
