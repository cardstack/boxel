import { type DBAdapter } from '@cardstack/runtime-common';
import {
  getUserByMatrixUserId,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import { MINIMUM_AI_CREDITS_TO_CONTINUE } from '@cardstack/runtime-common';
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
export class AICreditStrategy implements CreditStrategy {
  name = 'ai-credit-strategy';

  async validateCredits(dbAdapter: DBAdapter, matrixUserId: string) {
    const user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
    if (!user) {
      return {
        hasEnoughCredits: false,
        availableCredits: 0,
        errorMessage: 'User not found in database',
      };
    }

    const availableCredits = await sumUpCreditsLedger(dbAdapter, {
      userId: user.id,
    });

    if (availableCredits < MINIMUM_AI_CREDITS_TO_CONTINUE) {
      return {
        hasEnoughCredits: false,
        availableCredits,
        errorMessage: `You need a minimum of ${MINIMUM_AI_CREDITS_TO_CONTINUE} credits to continue. Please upgrade to a larger plan, or top up your account.`,
      };
    }

    return {
      hasEnoughCredits: true,
      availableCredits,
    };
  }

  async calculateCredits(response: any): Promise<number> {
    const generationId = extractGenerationIdFromResponse(response);
    return await calculateCreditsForOpenRouter(response, generationId);
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
