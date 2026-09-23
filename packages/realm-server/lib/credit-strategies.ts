import {
  type DBAdapter,
  MINIMUM_AI_CREDITS_TO_CONTINUE,
  logger,
} from '@cardstack/runtime-common';
import {
  validateAICredits,
  spendUsageCost as spendUsageCostFromBilling,
  fetchGenerationCostWithBackoff,
} from '@cardstack/billing/ai-billing';

const log = logger('credit-strategies');

export interface CreditStrategy {
  name: string;
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
  // Records `costInUsd` against the user's credits. The ledger write reads
  // the balance of each credit bucket before debiting it, so callers hold the
  // user's cost lock around this.
  spendUsageCost(
    dbAdapter: DBAdapter,
    matrixUserId: string,
    costInUsd: number,
  ): Promise<void>;
}

// Default AI Bot Credit Strategy (reused from AI bot)
export class OpenRouterCreditStrategy implements CreditStrategy {
  name = 'openrouter-credit-strategy';
  openRouterApiKey: string;

  constructor(openRouterApiKey: string) {
    this.openRouterApiKey = openRouterApiKey;
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
  ): Promise<void> {
    await spendUsageCostFromBilling(dbAdapter, matrixUserId, costInUsd);
  }
}

// No Credit Strategy (for free endpoints)
export class NoCreditStrategy implements CreditStrategy {
  name = 'no-credit-strategy';

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
  ): Promise<void> {
    // No-op for no-credit strategy
  }
}

// Credit Strategy Factory
export class CreditStrategyFactory {
  static create(strategyType: string, apiKey?: string): CreditStrategy {
    switch (strategyType) {
      case 'openrouter':
        if (!apiKey) {
          throw new Error('API key is required for OpenRouter credit strategy');
        }
        return new OpenRouterCreditStrategy(apiKey);
      case 'no-credit':
        return new NoCreditStrategy();
      default:
        throw new Error(`Unknown credit strategy: ${strategyType}`);
    }
  }
}
