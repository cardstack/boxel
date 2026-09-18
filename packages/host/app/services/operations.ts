import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import {
  OperationsError,
  SupportedMimeType,
  type OperationsAnswer,
  type OperationsEnvelope,
  type OperationsMethod,
  type OperationsTransport,
} from '@cardstack/runtime-common';

import type NetworkService from './network';
import type RealmService from './realm';

// ============================================================================
// The transport a card's operations are carried out over.
//
// `operations(card).addComment(…)` builds a batch and hands it here; this
// service is the one place that knows how a batch reaches a realm — the
// authenticated fetch, the method the realm derives its permission check from,
// and the client request id a write is tracked by. A card module has no
// service to inject, so the service registers itself on the global bridge the
// runtime declares (`getOperationsTransport`) and a call reads it back from
// there.
//
// Nothing here decides what a batch says. The envelope arrives built, and what
// comes back is handed over as the realm reported it: which entry answered
// what, and what each answer means, belongs to the client core, which is
// isomorphic and testable without any of this.
// ============================================================================

export default class OperationsService
  extends Service
  implements OperationsTransport
{
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  constructor(owner: Owner) {
    super(owner);
    // Registered on construction rather than when a session starts: a card can
    // invoke an operation as soon as it renders, and the transport itself holds
    // nothing session-scoped — the credentials live in the authenticated fetch
    // and the realm list in the realm service, both of which answer for the
    // session in hand.
    (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT = this;
    registerDestructor(this, () => {
      if ((globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT === this) {
        delete (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT;
      }
    });
  }

  // The realm a class-scoped create lands in when the caller names none. The
  // same realm a card created through the store lands in, so a card minted by
  // an operation and one minted by the store end up in the same place.
  defaultWritableRealm(): string | undefined {
    return this.realm.defaultWritableRealm?.path;
  }

  async send(
    realmURL: string,
    method: OperationsMethod,
    envelope: OperationsEnvelope,
    opts?: { clientRequestId?: string },
  ): Promise<OperationsAnswer> {
    this.assertMayWrite(method);
    let headers: Record<string, string> = {
      Accept: SupportedMimeType.BoxelOperations,
      'Content-Type': SupportedMimeType.BoxelOperations,
    };
    if (method === 'POST') {
      // Every write carries an id identifying who asked for it: the realm
      // stamps it on the index event the write produces, which is what lets a
      // client tell its own write's echo from anyone else's. The `instance:`
      // prefix is the convention the store's own writes use.
      //
      // Deliberately NOT registered with `cardService.clientRequestIds`. That
      // set is what makes the store *skip* reloading a card when the event
      // arrives, and the store may skip it because a save has already applied
      // the document it sent. An operation's answer carries identity and
      // version only — the new state was computed on the server — so
      // suppressing the event here would leave a transformed or appended card
      // showing pre-write values with nothing left to correct it. Until
      // something applies an operation's outcome locally, the event is the
      // only thing that refreshes the card, and it has to run.
      let clientRequestId = opts?.clientRequestId ?? `instance:${uuidv4()}`;
      headers['X-Boxel-Client-Request-Id'] = clientRequestId;
    } else {
      // A read-only batch is sent as a `QUERY`, which is the method the realm
      // reads as "authorized to read" — spelled the way every other QUERY the
      // host sends is, since a browser request cannot carry the method itself.
      headers['X-HTTP-Method-Override'] = 'QUERY';
    }
    let response = await this.network.authedFetch(`${realmURL}_operations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
    });
    if (!response.ok) {
      throw await refusal(response);
    }
    return (await response.json()) as OperationsAnswer;
  }

  // A store rendering for the indexer must never write: the render holds the
  // only worker while a write takes the realm's write lock and waits for a
  // reindex that needs that worker, so the write and the render wait on each
  // other. The prerender app marks itself, and every write from it is refused.
  //
  // This is the first of the two arms the store's own gate has, not both. The
  // store also refuses when its *own instance* is the render store and a
  // render is in flight (`isRenderStore && __boxelRenderContext`), which it can
  // ask because the caller is the store. An operation reaches the realm without
  // going through a store, so there is no such instance to ask about, and the
  // remaining signal — `__boxelRenderContext` alone — is set around every
  // in-browser index render in the ordinary app too: reading it here would
  // refuse a card's write for coinciding with someone else's indexing, which is
  // the failure the store's own comment warns against. So the deadlock this
  // guards is the prerender app's, which is where the sole worker and the write
  // lock meet.
  private assertMayWrite(method: OperationsMethod) {
    if (method !== 'POST') {
      return;
    }
    if ((globalThis as any).__boxelPrerenderApp) {
      throw new Error(
        `an operation that writes cannot run in a render: the render holds the worker a write would wait on, so the two would wait on each other`,
      );
    }
  }
}

// The realm's refusal, as the caller sees it.
//
// A batch is all-or-nothing, so a refused one answers with a single JSON:API
// error and nothing was written — including the entry it names. A response
// that is not that document at all is reported by status alone rather than
// read for members it does not carry.
async function refusal(response: Response): Promise<Error> {
  let body = await response.text();
  let error: Record<string, unknown> | undefined;
  try {
    let parsed = JSON.parse(body) as { errors?: Record<string, unknown>[] };
    error = parsed?.errors?.[0];
  } catch {
    error = undefined;
  }
  if (!error) {
    return new OperationsError({
      status: response.status,
      detail: body || response.statusText,
    });
  }
  let meta = (error.meta ?? {}) as { entry?: number | string };
  return new OperationsError({
    status: Number(error.status ?? response.status),
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    ...(typeof error.title === 'string' ? { title: error.title } : {}),
    ...(typeof error.detail === 'string' ? { detail: error.detail } : {}),
    ...(typeof error.id === 'string' ? { id: error.id } : {}),
    ...(meta.entry === undefined ? {} : { entry: meta.entry }),
  });
}

declare module '@ember/service' {
  interface Registry {
    operations: OperationsService;
  }
}
