// How a flow finishes (ADR 021 §1.7), only in the browser that started it.
//
// The secure origin's authorize page posts the user's decision without the
// provider's cookies (`consent.ts`), and gets a ticket. It then sends the
// browser, by a top-level GET, to the finish route, beneath the path of the
// interaction cookie the library set when the flow started. The flow finishes
// only when that cookie, the route's interaction ID and the ticket all name
// the same interaction. A decision made in another browser, such as by a
// victim sent an attacker's link, can't finish the flow: the victim's browser
// has the ticket but not the cookie, and the attacker's has the cookie but not
// the ticket. The ticket is spent on arrival, whether or not the flow
// finishes, so one copied out of a URL or a log is already useless.
//
// Allow creates a new OAuth grant holding exactly the scopes the flow asked
// for (§1.3), signs the flow in as the user who decided it, and the library
// sends the browser on to the app with a code. Deny, and a cancel from a page
// that has no session to decide with, send the app `access_denied`. Anything
// else ends on the error page for an expired request, which never says which
// check failed.
//
// The provider keeps no login between flows: each finish signs in afresh, and
// the resume route the library sends the browser to next drops any library
// session the browser brings, as the start of a flow does.

import type Koa from 'koa';
import type Provider from 'oidc-provider';
import { errors, type InteractionResults } from 'oidc-provider';
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import {
  dropCookies,
  errorPageURL,
  FIXED_ERROR_PAGES,
  navigate,
  sessionCookieNames,
} from './authorization.ts';
import { createGrant } from './grants.ts';
import {
  destroyConsentDecision,
  findConsentDecision,
  sha256Hex,
  takeConsentTicket,
} from './objects.ts';

const log = logger('boxel:oauth-provider');

// Why a finish request ended on the expired-request page. A fixed label for
// the log; the page itself is the same for each.
type FinishRefusal =
  | 'no-interaction'
  | 'other-interaction'
  | 'no-ticket'
  | 'ticket-mismatch'
  | 'undecided'
  | 'client-mismatch'
  | 'unknown-user';

// `GET /_oauth-provider/interaction/:uid/finish?ticket=…`, or `?cancel=1`.
export function finishHandler({
  provider,
  dbAdapter,
  secureOriginURL,
}: {
  provider: Provider;
  dbAdapter: DBAdapter;
  secureOriginURL: URL;
}): Koa.Middleware {
  return async function handleFinish(ctxt) {
    // The URL carries the interaction ID and a ticket.
    ctxt.set('Referrer-Policy', 'no-referrer');
    ctxt.set('Cache-Control', 'no-store');
    let uid: string = ctxt.params.uid;

    // Every ticket presented is spent, before any check.
    let tickets = presented(ctxt.query.ticket);
    let taken = await Promise.all(
      tickets.map((ticket) => takeConsentTicket(dbAdapter, ticket)),
    );

    let refuse = (reason: FinishRefusal) => {
      log.info(`flow not finished: ${reason}`);
      navigate(ctxt, errorPageURL(secureOriginURL, FIXED_ERROR_PAGES.expired));
    };

    // The interaction the browser's cookie names.
    let interaction;
    try {
      interaction = await provider.interactionDetails(ctxt.req, ctxt.res);
    } catch (error) {
      if (error instanceof errors.SessionNotFound) {
        return refuse('no-interaction');
      }
      throw error;
    }
    if (interaction.uid !== uid) {
      return refuse('other-interaction');
    }
    let clientId = interaction.params.client_id;

    if (ctxt.query.cancel === '1') {
      await destroyConsentDecision(dbAdapter, uid);
      log.info(`flow cancelled: client ${String(clientId)}`);
      return finish(ctxt, provider, {
        error: 'access_denied',
      });
    }

    if (tickets.length === 0) {
      return refuse('no-ticket');
    }
    if (tickets.length > 1 || taken[0]?.interaction !== sha256Hex(uid)) {
      return refuse('ticket-mismatch');
    }
    let decision = await findConsentDecision(dbAdapter, uid);
    if (!decision) {
      return refuse('undecided');
    }
    if (decision.clientId !== clientId) {
      return refuse('client-mismatch');
    }
    await destroyConsentDecision(dbAdapter, uid);

    if (!decision.allowed) {
      log.info(`flow finished: denied, client ${decision.clientId}`);
      return finish(ctxt, provider, {
        error: 'access_denied',
      });
    }

    let userId = await internalUserId(dbAdapter, decision.user);
    if (!userId) {
      return refuse('unknown-user');
    }
    let grantId = await createGrant(dbAdapter, {
      userId,
      clientId: decision.clientId,
      resources: decision.scopes,
      renewing: decision.renew,
    });
    log.info(
      `flow finished: allowed, client ${decision.clientId}, renewing ${decision.renew}`,
    );
    await finish(ctxt, provider, {
      login: { accountId: userId, remember: false },
      consent: { grantId },
    });
  };
}

// The resume route, `GET /_oauth-provider/auth/:uid`, before the library: it
// drops any library session the browser brings, so the flow signs in only as
// the user its finish named. A session left by another flow in the same
// browser would otherwise make the library answer with its logout
// confirmation, which Boxel doesn't serve. Its response sends the browser to
// the app with the code, so it sends no referrer.
export function resumeHandler({
  provider,
}: {
  provider: Provider;
}): Koa.Middleware {
  let sessionCookies = sessionCookieNames(provider);
  return async function handleResume(ctxt, next) {
    ctxt.set('Referrer-Policy', 'no-referrer');
    dropCookies(ctxt, sessionCookies);
    await next();
  };
}

// Records the result on the interaction the cookie names, and sends the
// browser to the resume route. The library writes the response.
async function finish(
  ctxt: Koa.Context,
  provider: Provider,
  result: InteractionResults,
) {
  ctxt.respond = false;
  await provider.interactionFinished(ctxt.req, ctxt.res, result, {
    mergeWithLastSubmission: false,
  });
}

// The values of a query parameter, ignoring empty ones.
function presented(value: string | string[] | undefined): string[] {
  let values =
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  return values.filter((entry) => entry.length > 0);
}

// The internal ID (`users.id`) of the user a Matrix ID names.
async function internalUserId(
  dbAdapter: DBAdapter,
  matrixUserId: string,
): Promise<string | undefined> {
  let [row] = (await dbAdapter.execute(
    `SELECT id FROM users WHERE matrix_user_id = $1`,
    { bind: [matrixUserId] },
  )) as { id: string }[];
  return row?.id;
}

// Whether `users` has a user with this internal ID, for the library's
// `findAccount`.
export async function userExists(
  dbAdapter: DBAdapter,
  userId: string,
): Promise<boolean> {
  let rows = await dbAdapter.execute(
    `SELECT 1 FROM users WHERE id::text = $1`,
    { bind: [userId] },
  );
  return rows.length > 0;
}
