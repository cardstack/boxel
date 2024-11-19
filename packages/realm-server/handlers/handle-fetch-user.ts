import { SupportedMimeType } from '@cardstack/runtime-common';
import Koa from 'koa';
import {
  sendResponseForNotFound,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { RealmServerTokenClaim } from '../utils/jwt';
import {
  getCurrentActiveSubscription,
  getMostRecentSubscriptionCycle,
  getPlanById,
  getUserByMatrixUserId,
  Plan,
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
      creditsIncludedInPlanAllowance: number;
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
  };
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
      await sendResponseForSystemError(ctxt, 'token is required to fetch user');
      return;
    }

    let { user: matrixUserId } = token;
    let user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
    if (!user) {
      await sendResponseForNotFound(ctxt, 'user is not found');
      return;
    }

    let mostRecentSubscription = await getCurrentActiveSubscription(
      dbAdapter,
      user.id,
    );
    let currentSubscriptionCycle: SubscriptionCycle | null = null;
    let plan: Plan | null = null;
    if (mostRecentSubscription) {
      [currentSubscriptionCycle, plan] = await Promise.all([
        getMostRecentSubscriptionCycle(dbAdapter, mostRecentSubscription.id),
        getPlanById(dbAdapter, mostRecentSubscription.planId),
      ]);
    }

    let creditsAvailableInPlanAllowance: number | null = null;
    let creditsIncludedInPlanAllowance: number | null = null;
    let extraCreditsAvailableInBalance: number | null = null;
    if (currentSubscriptionCycle) {
      [
        creditsAvailableInPlanAllowance,
        creditsIncludedInPlanAllowance,
        extraCreditsAvailableInBalance,
      ] = await Promise.all([
        sumUpCreditsLedger(dbAdapter, {
          creditType: ['plan_allowance', 'plan_allowance_used'],
          subscriptionCycleId: currentSubscriptionCycle.id,
        }),
        sumUpCreditsLedger(dbAdapter, {
          creditType: ['plan_allowance'],
          subscriptionCycleId: currentSubscriptionCycle.id,
        }),
        sumUpCreditsLedger(dbAdapter, {
          creditType: ['extra_credit', 'extra_credit_used'],
        }),
      ]);
    }

    let responseBody = {
      data: {
        type: 'user',
        id: user.id,
        attributes: {
          matrixUserId: user.matrixUserId,
          stripeCustomerId: user.stripeCustomerId,
          creditsAvailableInPlanAllowance,
          creditsIncludedInPlanAllowance,
          extraCreditsAvailableInBalance,
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
      },
      included:
        mostRecentSubscription && plan
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
                      id: plan.id,
                    },
                  },
                },
              },
              {
                type: 'plan',
                id: plan.id,
                attributes: {
                  name: plan.name,
                  monthlyPrice: plan.monthlyPrice,
                  creditsIncluded: plan.creditsIncluded,
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
