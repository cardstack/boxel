import type { Plan, SubscriptionCycle } from '@cardstack/runtime-common';
import { SupportedMimeType } from '@cardstack/runtime-common';
import type Koa from 'koa';
import {
  sendResponseForNotFound,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { RealmServerTokenClaim } from '../utils/jwt';
import {
  getCurrentActiveSubscription,
  getMostRecentSubscriptionCycle,
  getPlanById,
  getUserByMatrixUserId,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import type { CreateRoutesArgs } from '../routes';

type FetchUserResponse = {
  data: {
    type: 'user';
    id: string;
    attributes: {
      matrixUserId: string;
      stripeCustomerId: string;
      stripeCustomerEmail: string;
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

    let currentActiveSubscription = await getCurrentActiveSubscription(
      dbAdapter,
      user.id,
    );
    let currentSubscriptionCycle: SubscriptionCycle | null = null;
    let plan: Plan | null = null;
    if (currentActiveSubscription) {
      [currentSubscriptionCycle, plan] = await Promise.all([
        getMostRecentSubscriptionCycle(dbAdapter, currentActiveSubscription.id),
        getPlanById(dbAdapter, currentActiveSubscription.planId),
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
          creditType: [
            'extra_credit',
            'extra_credit_used',
            'daily_credit',
            'daily_credit_used',
          ],
          userId: user.id,
        }),
      ]);
    } else {
      extraCreditsAvailableInBalance = await sumUpCreditsLedger(dbAdapter, {
        creditType: [
          'extra_credit',
          'extra_credit_used',
          'daily_credit',
          'daily_credit_used',
        ],
        userId: user.id,
      });
    }

    let responseBody = {
      data: {
        type: 'user',
        id: user.id,
        attributes: {
          matrixUserId: user.matrixUserId,
          stripeCustomerId: user.stripeCustomerId,
          stripeCustomerEmail: user.stripeCustomerEmail,
          creditsAvailableInPlanAllowance,
          creditsIncludedInPlanAllowance,
          extraCreditsAvailableInBalance,
        },
        relationships: {
          subscription: currentActiveSubscription
            ? {
                data: {
                  type: 'subscription',
                  id: currentActiveSubscription.id,
                },
              }
            : null,
        },
      },
      included:
        currentActiveSubscription && plan
          ? [
              {
                type: 'subscription',
                id: currentActiveSubscription.id,
                attributes: {
                  startedAt: currentActiveSubscription.startedAt,
                  endedAt: currentActiveSubscription.endedAt ?? null,
                  status: currentActiveSubscription.status,
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
          : [
              {
                type: 'plan',
                id: 'free',
                attributes: {
                  name: 'Free',
                  monthlyPrice: 0,
                  creditsIncluded: 0,
                },
              },
            ],
    } as FetchUserResponse;

    return setContextResponse(
      ctxt,
      new Response(JSON.stringify(responseBody), {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      }),
    );
  };
}
