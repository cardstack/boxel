import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import {
  mutateBxlCardSource,
  mutationSchemaForCardSource,
} from '@cardstack/bxl/mutation';

import { v4 as uuidv4 } from 'uuid';

import {
  identifyCard,
  isCardInstance,
  localId as localIdSymbol,
  mintedIdentities,
  OperationsError,
  rri,
  stampBaseVersion,
  SupportedMimeType,
  writeResultIn,
  type CodeRef,
  type Definition,
  type LooseCardResource,
  type OperationsAnswer,
  type OperationsEnvelope,
  type OperationsMethod,
  type OperationsSearch,
  type OperationsTransport,
  type OptimisticCandidate,
  type SearchEntries,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';
import { lowerOperationDeclarations } from '@cardstack/runtime-common/card-operations';
import type { OperationDefinition } from '@cardstack/runtime-common/card-operations';
import { Loader } from '@cardstack/runtime-common/loader';

import { makeDefinitionLookup } from '../lib/definition-lookup';
import OperationLedger from '../lib/operation-ledger';

import { getSearchEntriesResource } from '../resources/search-entries';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type MatrixService from './matrix-service';
import type NetworkService from './network';
import type RealmService from './realm';
import type StoreService from './store';
import type { LoweredOperation } from '../lib/operation-ledger';

import type { CardDef } from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';
import type * as OperationsAPI from '@cardstack/base/operations';

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
//
// A saved search is the other half of the bridge. A `query` operation is never
// sent to `_operations` — it is carried out by the search engine, which the
// host already reaches through its live entries resource — so what this
// supplies for one is the session it runs in: who the caller is, which realm
// holds a type, and the resource a search answers with.
// ============================================================================

export default class OperationsService
  extends Service
  implements OperationsTransport
{
  @service declare private cardService: CardService;
  @service declare private loaderService: LoaderService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  // Built on first use rather than on construction: a session that never
  // invokes an optimistic operation never subscribes to the store's reloads.
  #ledger: OperationLedger | undefined;
  // One lowering per type per loader. A declaration is fixed for the life of a
  // loaded module, and the loader is replaced whenever a module changes — so
  // keying the cache by loader is what retires an entry for a type whose
  // module was edited, with no invalidation rule of its own.
  #lowered: WeakMap<
    Loader,
    Map<string, Promise<Record<string, OperationDefinition> | undefined>>
  > = new WeakMap();

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

  // What a saved search needs from this session.
  //
  // The resource is the host's one live search: it issues the wire query
  // through the store, subscribes to each realm it covers, and re-runs as
  // those realms index — which is what makes a query's freshness index
  // freshness. It reads its query back through the thunk, so the search
  // follows what the invocation resolves to rather than being rebuilt.
  //
  // A search with no owner is tied to this service, and a service is destroyed
  // when the application instance is — not when a session ends, since signing
  // out resets state rather than tearing services down. So an ownerless search
  // lives for the life of the tab: it keeps its realm subscriptions and keeps
  // re-running across a sign-out and the next sign-in. That is the right bound
  // for a search the whole session reads and the wrong one for a search a
  // single view wants, which is why a caller with a shorter life — a
  // component, a controller — names itself as the owner and has its search
  // torn down with it. A card instance is not owned by the application, so a
  // card that keeps a search in a field takes the tab-lived one; a card that
  // wants the search to end with a view hands the query to the search
  // component instead of holding the resource.
  search: OperationsSearch = {
    actor: () => this.sessionActor(),
    realmFor: (identifier: string) => this.realm.realmOf(rri(identifier)),
    entries: (
      getQuery: () => SearchEntryWireQuery,
      opts?: { owner?: object },
    ): SearchEntries => getSearchEntriesResource(opts?.owner ?? this, getQuery),
  };

  // Who this session is, when it can say — what a saved search compares
  // against, and what an operation's `actor()` resolves to when its program is
  // run locally.
  //
  // Nobody, inside the dedicated prerender app: that app authenticates as
  // itself so it can render any card, and its identity is not the identity of
  // whoever is later served the HTML it produces. A search that resolved the
  // actor there would put one user's rows into a rendering everyone reads, and
  // the store's own rule for that app — render as a pure function of the
  // document you were handed — is the same rule. The saved search answers no
  // rows there and the live render that follows fills them in.
  //
  // Nobody, too, before the matrix client is up or after a sign-out, where
  // reading the id throws rather than answering. A query that does not read
  // the actor is unaffected in all three cases.
  private sessionActor(): string | undefined {
    if ((globalThis as any).__boxelPrerenderApp) {
      return undefined;
    }
    try {
      return this.matrixService.userId ?? undefined;
    } catch {
      return undefined;
    }
  }

  async send(
    realmURL: string,
    method: OperationsMethod,
    envelope: OperationsEnvelope,
    opts?: {
      clientRequestId?: string;
      adopted?: string[];
      optimistic?: OptimisticCandidate;
    },
  ): Promise<OperationsAnswer> {
    this.assertMayWrite(method);
    let headers: Record<string, string> = {
      Accept: SupportedMimeType.BoxelOperations,
      'Content-Type': SupportedMimeType.BoxelOperations,
    };
    if (method !== 'POST') {
      // A read-only batch is sent as a `QUERY`, which is the method the realm
      // reads as "authorized to read" — spelled the way every other QUERY the
      // host sends is, since a browser request cannot carry the method itself.
      // It takes no lock and mints nothing, so none of what follows applies.
      headers['X-HTTP-Method-Override'] = 'QUERY';
      return await this.fetchAnswer(realmURL, headers, envelope);
    }
    // Every write carries an id identifying who asked for it: the realm stamps
    // it on the index event the write produces, which is what lets a client
    // tell its own write's echo from anyone else's. The `instance:` prefix is
    // the convention the store's own writes use.
    //
    // Registering it is what lets the store recognize the echo as ours. The
    // store does not read that as "skip this pass": the event names which of
    // the cards it carries were written from content this client sent, and
    // only those are skipped — the rest of the batch took state the realm
    // computed, which nothing here holds and the event is the only word of.
    // So a card this batch minted from an instance keeps whatever was typed
    // into it while the batch was in flight, and a card the batch transformed
    // or appended to still refreshes.
    let clientRequestId = opts?.clientRequestId ?? `instance:${uuidv4()}`;
    this.cardService.clientRequestIds.add(clientRequestId);
    headers['X-Boxel-Client-Request-Id'] = clientRequestId;

    // A call the client core found no structural reason to refuse optimism for
    // is offered to the ledger, which answers the rest of the question — is
    // this session holding the card, does the declaration lower, is what it
    // lowers to deterministic — and carries the send itself when it can. An
    // answer of nothing means it declined without applying or sending
    // anything, and the batch goes out below exactly as it would have.
    if (opts?.optimistic) {
      let optimistic = await this.ledger().attempt({
        realmURL,
        envelope,
        candidate: opts.optimistic,
        clientRequestId,
      });
      if (optimistic) {
        return optimistic;
      }
    }

    // The cards this batch mints that the store is already holding instances
    // of. Their saves and this write are the same card being written, so they
    // queue behind one another: an autosave that starts while the batch is in
    // flight waits for the realm to name the card and then PATCHes it, rather
    // than posting a second one.
    let adopted = opts?.adopted ?? [];
    return await this.store.withMutationLocks(adopted, async () => {
      // A save of a card linking to one of these waits for the answer rather
      // than sending the card a second time as one to create.
      let endCreates = this.store.beginCreates(adopted);
      try {
        let answer = await this.fetchAnswer(realmURL, headers, envelope);
        // Held instances take their names from the answer rather than from
        // the event that follows it: the answer is the first and the certain
        // word, and the promotion it drives — the identity map, the realm
        // subscription, autosave, consumers in other realms — is what the
        // store does for any card it learns a URL for.
        await this.store.adoptMintedIdentities(mintedIdentities(answer));
        return answer;
      } finally {
        endCreates();
      }
    });
  }

  // ==========================================================================
  // The optimistic path
  // ==========================================================================

  private ledger(): OperationLedger {
    if (!this.#ledger) {
      let ledger = new OperationLedger({
        held: (id) => {
          let instance = this.store.peek(rri(id));
          // An error placeholder is not a card whose source a program could be
          // planned against. Asked by what it is rather than by whether it
          // carries an id, because a recorded error carries one too — it names
          // the card it stands in for.
          return isCardInstance(instance) ? (instance as CardDef) : undefined;
        },
        localId: (instance) => instance[localIdSymbol],
        lower: (instance, name) => this.loweredOperation(instance, name),
        applyLocally: (instance, operation, params) =>
          this.applyOperationLocally(instance, operation, params),
        reload: (instance) => this.store.reloadForRollback(instance),
        heldVersion: (instance) => this.store.operationVersionOf(instance),
        recordVersion: (instance, version) =>
          this.store.recordOperationVersion(instance, version),
        withLock: (localId, fn) => this.store.withMutationLocks([localId], fn),
        send: (realmURL, envelope, clientRequestId) =>
          this.fetchAnswer(
            realmURL,
            {
              Accept: SupportedMimeType.BoxelOperations,
              'Content-Type': SupportedMimeType.BoxelOperations,
              'X-Boxel-Client-Request-Id': clientRequestId,
            },
            envelope,
          ),
        stamp: stampBaseVersion,
        writeResult: writeResultIn,
        onReload: (cb) => this.store.onCardReloaded(cb),
        drained: (localId) => this.store.releaseOptimisticFields(localId),
      });
      registerDestructor(this, () => ledger.teardown());
      this.#ledger = ledger;
    }
    return this.#ledger;
  }

  // The loader that built this instance's class.
  //
  // Not the session's current loader, which is a different object after any
  // reset — and a card the store is already holding keeps the class the
  // loader that built it produced. Every identity check downstream compares
  // against that class: `getDeclaredOperations` asks whether it extends
  // `BaseDef`, and the `BaseDef` it compares against is whichever copy of the
  // base module the importing loader resolved. Ask the current loader after a
  // reset and the answer is "this class does not extend BaseDef" — true of
  // the two copies, and useless — so every operation on a resident card would
  // quietly stop being optimistic from the first reset onward.
  //
  // Falls back to the session's loader for a class no loader claims, which is
  // the same loader that would have been used before this existed.
  private loaderFor(instance: CardDef): Loader {
    return (
      Loader.getLoaderFor(instance.constructor) ?? this.loaderService.loader
    );
  }

  // The operation as the realm stored it, lowered here from the same
  // declaration by the same function the indexer runs.
  //
  // Lowered locally rather than fetched: the class is loaded in this browser,
  // so the declaration is in hand, and reading the realm's copy would put a
  // network round trip in front of the path whose whole purpose is to avoid
  // one. Byte-identical by construction, because it is one function over one
  // declaration against one definition graph — which is also why the
  // definition lookup is shared with the indexer rather than written twice.
  private async loweredOperation(
    instance: CardDef,
    name: string,
  ): Promise<OperationDefinition | undefined> {
    let operations = await this.loweredOperationsFor(instance);
    return operations?.[name];
  }

  private async loweredOperationsFor(
    instance: CardDef,
  ): Promise<Record<string, OperationDefinition> | undefined> {
    let loader = this.loaderFor(instance);
    let codeRef = identifyCard(
      instance.constructor as typeof CardAPI.BaseDef,
    ) as CodeRef | undefined;
    if (!codeRef || !('module' in codeRef) || !('name' in codeRef)) {
      // A class no module exports cannot be named to the realm either, so
      // there is no operation here to be optimistic about.
      return undefined;
    }
    let key = `${codeRef.module}/${codeRef.name}`;
    let byType = this.#lowered.get(loader);
    if (!byType) {
      byType = new Map();
      this.#lowered.set(loader, byType);
    }
    let lowered = byType.get(key);
    if (!lowered) {
      lowered = this.lowerDeclarations(instance, codeRef, loader);
      byType.set(key, lowered);
    }
    return await lowered;
  }

  private async lowerDeclarations(
    instance: CardDef,
    codeRef: CodeRef,
    loader: Loader,
  ): Promise<Record<string, OperationDefinition> | undefined> {
    try {
      // Both resolved through the instance's own loader, so the classes these
      // modules compare against are the classes this card was built from.
      let api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
      let operationsApi = await loader.import<typeof OperationsAPI>(
        '@cardstack/base/operations',
      );
      let declared = operationsApi.getDeclaredOperations(
        instance.constructor as typeof CardAPI.BaseDef,
      );
      if (Object.keys(declared).length === 0) {
        return undefined;
      }
      let lookupDefinition = makeDefinitionLookup(
        api,
        loader,
        'optimistic operation lowering',
      );
      let definition = await lookupDefinition(codeRef);
      if (!definition) {
        return undefined;
      }
      let { operations } = await lowerOperationDeclarations(declared, {
        definition,
        lookupDefinition,
        identifyCard: (def) => identifyCard(def) as CodeRef,
      });
      return operations;
    } catch (err: unknown) {
      // Lowering is how this path decides it *can* be optimistic. A failure
      // here means it cannot, which the realm is entirely able to cope with —
      // so it is reported and the write goes out pessimistically.
      console.warn(
        `could not lower operations for ${JSON.stringify(codeRef)} locally, so writes to it are sent and awaited: ${
          (err as Error)?.message ?? String(err)
        }`,
        (err as Error)?.stack,
      );
      return undefined;
    }
  }

  // Run the operation's program over the card's own stored source and put the
  // result back on the instance.
  //
  // The same function the realm's `transform` executor runs, over the same
  // document, with the same context — which is what makes "the local result
  // equals the authoritative result" a property of the arrangement rather than
  // a claim to be checked. The realm reads the card's stored `.json`; the
  // serialization here is that document, since it is what a save of this
  // instance would store.
  //
  // What the realm has and this does not is the index overlay it lays *under*
  // the stored document, which is what lets a program read a computed field or
  // a linked card's field. No overlay is supplied here, so such a read is
  // refused by the program rather than answered with a value this client
  // guessed — and the refusal reaches the ledger as a throw, which sends the
  // operation pessimistically. Fails closed on purpose: a wrong local value
  // would be confirmed by `baseMatched` and never corrected.
  private async applyOperationLocally(
    instance: CardDef,
    operation: LoweredOperation,
    params: Record<string, unknown> | undefined,
  ): Promise<void> {
    let program = operation.program;
    if (!program) {
      throw new Error('the operation carries no program to run');
    }
    if (programNamesRealmConfig(program.source)) {
      // The realm reads its own config document to answer `realmConfig()`.
      // Nothing here holds one, and running the program without it would
      // silently substitute nothing for a value the realm will supply.
      throw new Error(
        'the program reads the realm config, which only the realm can supply',
      );
    }
    let codeRef = identifyCard(
      instance.constructor as typeof CardAPI.BaseDef,
    ) as CodeRef | undefined;
    if (!codeRef) {
      throw new Error('the card names no type to plan the program against');
    }
    let loader = this.loaderFor(instance);
    let api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
    let lookupDefinition = makeDefinitionLookup(
      api,
      loader,
      'optimistic operation lowering',
    );
    let definition = await lookupDefinition(codeRef);
    if (!definition) {
      throw new Error("the card's type has no definition to plan against");
    }
    // The card as the realm stores it: its own field values, links as links,
    // no computed values and no side-loaded graph. The same shape the stored
    // `.json` holds, which is the document the realm plans against.
    let doc = await this.cardService.serializeCard(instance, {
      useAbsoluteURL: true,
      omitQueryFields: true,
    });
    let resource = doc.data as LooseCardResource;
    // The same identity the realm will authenticate this request as, so a
    // program reading `actor()` reads one value rather than two.
    let actor = this.sessionActor();
    // Everything about this card that only the realm's index can answer,
    // declared as such. Without it a program reading a computed field would
    // not be refused — it would read straight through to the stored document,
    // find nothing there, and carry on with a null the realm is about to
    // replace with a computed value. That result would then be confirmed by
    // `baseMatched`, because the base really did match; the divergence is in
    // the program's inputs rather than in the version, so nothing downstream
    // could catch it.
    let overlays = {
      unavailable: await this.unavailableHere(definition, lookupDefinition),
    };
    let schema = await mutationSchemaForCardSource(
      definition as unknown as Parameters<
        typeof mutationSchemaForCardSource
      >[0],
      { lookupDefinition: lookupDefinition as never },
    );
    let { document } = mutateBxlCardSource(
      { data: resource } as never,
      program.source,
      {
        schema,
        syntax: program.syntax,
        programId: `optimistic:${uuidv4()}`,
        ...(instance.id ? { targetId: instance.id } : {}),
        context: {
          ...(params ? { params } : {}),
          ...(actor ? { actor } : {}),
          instance: {
            ...(instance.id ? { id: instance.id } : {}),
            ...((resource.attributes ?? {}) as Record<string, unknown>),
          },
        },
        overlays,
        // No `resolveReference`, unlike the realm's own run. A relationship is
        // stored relative to the file that holds it, so the realm resolves the
        // stored spelling on the way in; this serialization was asked for
        // absolute URLs, so its links arrive already resolved and a second
        // pass would have nothing to do.
        //
        // A program naming a card to link to gets the identity back, the same
        // answer the realm's own planner is given. Whether that card exists is
        // the realm's to refuse, and it does so on the write.
        resolveCard: (id: string) => ({ id }),
      } as never,
    );
    await this.store.applyOperationSource(
      instance,
      (document as unknown as { data: LooseCardResource }).data,
      resource,
    );
  }

  // The paths a program may read that a browser cannot answer for.
  //
  // The realm lays two things under the stored document before it runs a
  // program: the index's rendering of the card, which is where its computed
  // values are, and the denormalized fields of the cards it links to. A client
  // holds neither, so from a program's point of view this session is exactly
  // the realm's own "there is no index row for this card" case — and it is
  // described the same way, with the same tiers and the same reason, so the
  // planner refuses the same reads on both sides.
  //
  // Declared per path rather than by refusing the whole field: a link is still
  // perfectly writable — appending a card to a collection reads nothing — and
  // it is only the linked card's *fields* that are out of reach. The members
  // are enumerated from the target's own definition, which is the list the
  // realm builds from too.
  private async unavailableHere(
    definition: Definition,
    lookupDefinition: (codeRef: CodeRef) => Promise<Definition | undefined>,
  ): Promise<{ path: string; tier: 'computed' | 'linked'; reason: string }[]> {
    let unavailable: {
      path: string;
      tier: 'computed' | 'linked';
      reason: string;
    }[] = [];
    for (let [field, defId] of Object.entries(definition.fields)) {
      let fieldDef = definition.fieldDefs[defId];
      if (!fieldDef) {
        continue;
      }
      if (fieldDef.isComputed) {
        unavailable.push({
          path: field,
          tier: 'computed',
          reason: 'not-indexed',
        });
        continue;
      }
      if (fieldDef.type !== 'linksTo') {
        continue;
      }
      let linked = await lookupDefinition(fieldDef.fieldOrCard);
      for (let member of Object.keys(linked?.fields ?? {})) {
        if (member === 'id') {
          continue;
        }
        unavailable.push({
          path: `${field}.${member}`,
          tier: 'linked',
          reason: 'not-indexed',
        });
      }
    }
    return unavailable;
  }

  private async fetchAnswer(
    realmURL: string,
    headers: Record<string, string>,
    envelope: OperationsEnvelope,
  ): Promise<OperationsAnswer> {
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

// Whether a program reads the realm's config document. Spelled the same way
// the realm's own executor asks it, and for the same reason: the name is a
// builtin, and a program that never mentions it never needs one supplied.
function programNamesRealmConfig(source: string): boolean {
  return source.includes('realmConfig');
}

declare module '@ember/service' {
  interface Registry {
    operations: OperationsService;
  }
}
