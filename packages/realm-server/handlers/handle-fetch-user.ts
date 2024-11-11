import { SupportedMimeType } from '@cardstack/runtime-common';
import Koa from 'koa';
import { sendResponseForSystemError, setContextResponse } from '../middleware';
import { RealmServerTokenClaim } from '../utils/jwt';
import {
  getMostRecentSubscription,
  getMostRecentSubscriptionCycle,
  getPlan,
  getUserByMatrixUserId,
  Plan,
  Subscription,
  SubscriptionCycle,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import { CreateRoutesArgs } from '../routes';

type FetchUserResponse = {
  data: {
    type: 'user';
    id: string;
    attributes: {
      matrixUserId: string;
      stripeCustomerId: string;
      creditsAvailableInPlanAllowance: number;
      extraCreditsAvailableInBalance: number;
    };
    relationships: {
      subscription: {
        data: {
          type: 'subscription';
          id: string;
        };
      } | null;
    };
  } | null;
  included:
    | [
        {
          type: 'subscription';
          id: string;
          attributes: {
            startedAt: number;
            endedAt: number | null;
            status: string;
          };
          relationships: {
            plan: {
              data: {
                type: 'plan';
                id: string;
              };
            };
          };
        },
        {
          type: 'plan';
          id: string;
          attributes: {
            name: string;
            monthlyPrice: number;
            creditsIncluded: number;
          };
        },
      ]
    | null;
};

export default function handleFetchUserRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to create realm',
      );
      return;
    }

    let { user: matrixUserId } = token;
    let user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
    let mostRecentSubscription: Subscription | null = null;
    if (user) {
      mostRecentSubscription = await getMostRecentSubscription(
        dbAdapter,
        user.id,
      );
    }

    let currentSubscriptionCycle: SubscriptionCycle | null = null;
    let plan: Plan | undefined = undefined;
    if (mostRecentSubscription) {
      [currentSubscriptionCycle, plan] = await Promise.all([
        getMostRecentSubscriptionCycle(dbAdapter, mostRecentSubscription.id),
        getPlan(dbAdapter, mostRecentSubscription.planId),
      ]);
    }

    let extraCreditsAvailableInBalance: number | null = null;
    let creditsAvailableInPlanAllowance: number | null = null;
    if (currentSubscriptionCycle) {
      [extraCreditsAvailableInBalance, creditsAvailableInPlanAllowance] =
        await Promise.all([
          sumUpCreditsLedger(dbAdapter, {
            creditType: ['extra_credit', 'extra_credit_used'],
          }),
          sumUpCreditsLedger(dbAdapter, {
            creditType: ['plan_allowance', 'plan_allowance_used'],
            subscriptionCycleId: currentSubscriptionCycle.id,
          }),
        ]);
    }

    let responseBody = {
      data: user
        ? {
            type: 'user',
            id: user.id,
            attributes: {
              matrixUserId: user.matrixUserId,
              stripeCustomerId: user.stripeCustomerId,
              creditsAvailableInPlanAllowance: creditsAvailableInPlanAllowance,
              extraCreditsAvailableInBalance: extraCreditsAvailableInBalance,
            },
            relationships: {
              subscription: mostRecentSubscription
                ? {
                    data: {
                      type: 'subscription',
                      id: mostRecentSubscription.id,
                    },
                  }
                : null,
            },
          }
        : null,
      included: mostRecentSubscription
        ? [
            {
              type: 'subscription',
              id: mostRecentSubscription.id,
              attributes: {
                startedAt: mostRecentSubscription.startedAt,
                endedAt: mostRecentSubscription.endedAt ?? null,
                status: mostRecentSubscription.status,
              },
              relationships: {
                plan: {
                  data: {
                    type: 'plan',
                    id: plan!.id,
                  },
                },
              },
            },
            {
              type: 'plan',
              id: plan!.id,
              attributes: {
                name: plan!.name,
                monthlyPrice: plan!.monthlyPrice,
                creditsIncluded: plan!.creditsIncluded,
              },
            },
          ]
        : null,
    } as FetchUserResponse;

    return setContextResponse(
      ctxt,
      new Response(JSON.stringify(responseBody), {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      }),
    );
  };
}
