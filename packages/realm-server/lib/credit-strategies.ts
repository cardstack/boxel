import {
  type DBAdapter,
  MINIMUM_AI_CREDITS_TO_CONTINUE,
} from '@cardstack/runtime-common';
import { validateAICredits } from '@cardstack/billing/ai-credit-validation';
import {
  calculateCreditsForOpenRouter,
  extractGenerationIdFromResponse,
} from './credit-calculator';

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
  calculateCredits(response: any): Promise<number>;
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

  async calculateCredits(response: any): Promise<number> {
    const generationId = extractGenerationIdFromResponse(response);
    return await calculateCreditsForOpenRouter(
      response,
      this.openRouterApiKey,
      generationId,
    );
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

  async calculateCredits(_response: any): Promise<number> {
    return 0;
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
