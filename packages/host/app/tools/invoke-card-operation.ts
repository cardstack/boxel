import { service } from '@ember/service';

import {
  humanReadable,
  isCardInstance,
  isResolvedCodeRef,
  realmURL,
} from '@cardstack/runtime-common';
import type {
  BaseOperation,
  CodeRef,
  OperationWriteResult,
} from '@cardstack/runtime-common';
import { isWrite } from '@cardstack/runtime-common/card-operations';

import {
  BATCH_MEMBER,
  assertPayloadSuppliesParams,
  baseOf,
  defNameOf,
  invocableNames,
  invokeOnType,
  loadOperationType,
  offeredHere,
  type OperationsBucket,
} from '../lib/card-operation-invocation';
import HostBaseTool from '../lib/host-base-tool';

import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';
import type * as OperationsModule from '@cardstack/base/operations';

export default class InvokeCardOperationTool extends HostBaseTool<
  typeof BaseToolModule.InvokeCardOperationInput,
  typeof BaseToolModule.InvokeCardOperationResult
> {
  @service declare private store: StoreService;

  static actionVerb = 'Invoke';

  description = `Invoke an operation that a card's type declares - a named action its author defined, such as "addComment" or "archive", that the realm carries out in one authorized request applying the author's own rules. Prefer it over patching a card by hand whenever the type declares one for the change you want.

Naming an operation a card does not carry is refused with the list of the ones it does, so a wrong guess costs one call and answers the question. The card's source shows the same names, written as its "@operation" declarations, together with the "params" each one takes.

"payload" supplies those params, keyed exactly as the declaration names them. A param the declaration requires and the payload omits is refused before anything is sent - unless the declaration computes that param itself, in which case leaving it out is how you take the value it computes rather than one you invented.

Besides a type's declared operations, the plain "create" mints a new card of the type of the card at "cardId". It alone reads the other two inputs: "payload" as the new card's field values, "relationships" as the cards it is created linking to - JSON:API relationship objects such as {"author": {"links": {"self": "<card id>"}}} - and "realm" as where it lands, which defaults to the realm holding the card at "cardId". Every other operation reached through "cardId" acts on that card and runs in that card's own realm, so it takes neither "realm" nor "relationships".

An operation that acts on a type rather than on one of its cards - the plain "create", or a create the type declares - needs no card at all: give "type", the type's module and export name such as {"module": "https://realm.example/member", "name": "Member"} (the same pair a realm's policy names a type by), in place of "cardId", and "realm", the realm it runs in and where a card it creates lands. That is how the first card of a type is made in a realm that holds none. A relative "module" is read from the root of "realm". An operation that acts on a card is refused when named on a type, with the ones the type carries.

A write answers the card it wrote and the version that card now holds; a read answers the document. A write whose indexing is still pending says so with "indexPending", and a search may not show it until it lands; set "skipIndexWait" to have a write answer without waiting for that indexing at all.`;

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { InvokeCardOperationInput } = commandModule;
    return InvokeCardOperationInput;
  }

  // One of `cardId` and `type` is required too, which a schema of required
  // fields cannot say, so `run` refuses a call naming neither or both.
  requireInputFields = ['operation'];

  protected async run(
    input: BaseToolModule.InvokeCardOperationInput,
  ): Promise<BaseToolModule.InvokeCardOperationResult> {
    let type = givenType(input.type);
    if (Boolean(input.cardId) === Boolean(type)) {
      throw new Error(
        `"${input.operation}" is reached through exactly one of "cardId", a card to act on, and "type", a type to act on with no card - ${
          input.cardId ? 'not both' : 'give one'
        }.`,
      );
    }
    if (type) {
      return await this.runOnType(input, type);
    }
    return await this.runOnCard(input);
  }

  private async runOnCard(
    input: BaseToolModule.InvokeCardOperationInput,
  ): Promise<BaseToolModule.InvokeCardOperationResult> {
    let card = await this.store.get(input.cardId);
    if (!isCardInstance(card)) {
      throw new Error(
        `cannot invoke "${input.operation}": ${input.cardId} did not load: ${card.message}`,
      );
    }

    let operationsModule = await this.loadOperationsModule();
    let bucketFor = operationsModule.operations as (
      target: unknown,
      opts?: { skipIndexWait?: boolean },
    ) => OperationsBucket;
    let sending = input.skipIndexWait ? { skipIndexWait: true } : undefined;
    let declarations = operationsModule.getDeclaredOperations(card);
    let onInstance = bucketFor(card, sending);
    let name = input.operation;

    // The two scopes a name can be invocable in. An instance-scoped member
    // acts on the card the caller named; a type-scoped one — the plain
    // `create` — acts on that card's class, which is how a single card id
    // names a type.
    //
    // The class's bucket is built only once the instance's turns out not to
    // carry the name, because building it means naming the class, which a
    // card whose type no module exports cannot do: asking eagerly would turn
    // that into a refusal of an instance-scoped call that had no need of a
    // class at all.
    let scope: 'instance' | 'type' = 'instance';
    let bucket = onInstance;
    if (name === BATCH_MEMBER || typeof onInstance[name] !== 'function') {
      scope = 'type';
      bucket = bucketFor(card.constructor, sending);
      if (typeof bucket[name] !== 'function') {
        throw new Error(
          `"${name}" is not an operation ${defNameOf(card)} carries. It carries: ${invocableNames(
            [
              { scope: 'instance', bucket: onInstance },
              { scope: 'type', bucket },
            ],
            declarations,
          ).join(', ')}`,
        );
      }
    }

    let base = baseOf(name, declarations);
    // The plain `create` is the one behavior that mints a card the caller
    // describes outright, and so the one that reads where it lands and what it
    // links to. Everything else either acts on a card that already exists, or
    // — a declared create — describes the new card from its own params.
    let mintsACard = base === 'create' && !declarations[name];
    if (base === 'query') {
      throw new Error(
        `"${name}" is a query operation: it answers a live set of search results that re-runs as realms index, not a value this tool can hand back. Search with search-entries instead; a card reads the same search by handing the query to its search results component.`,
      );
    }
    if (!offeredHere(name, scope, base, declarations)) {
      throw new Error(
        `"${name}" is a behavior every card carries rather than an operation ${defNameOf(card)} declares, and this tool invokes what a type declares plus the plain "create".${
          ELSEWHERE[base] ? ` ${ELSEWHERE[base]}` : ''
        }`,
      );
    }
    if (scope === 'instance' && input.realm) {
      throw new Error(
        `"${name}" acts on ${input.cardId} and runs in the realm that holds it, so it cannot be given a realm to run in. A realm names where a card a "create" mints lands.`,
      );
    }
    if (mintsACard && !input.realm && !card[realmURL]) {
      // The realm a minted card lands in is the one holding the card that
      // named its type, so a target that is in no realm yet leaves the caller's
      // description of where it goes unanswerable. Refused rather than allowed
      // to fall back to whichever realm the session writes to by default: that
      // fallback is the silent write to an unnamed realm this tool exists not
      // to do.
      throw new Error(
        `"${name}" mints a new card in the realm holding ${input.cardId}, and that card is in no realm yet. Name where it should land with "realm".`,
      );
    }
    if (input.relationships && !mintsACard) {
      throw new Error(
        `"${name}" is not the plain "create", so it has no new card for "relationships" to describe. ${
          base === 'create'
            ? `"${name}" declares what it creates, so the cards it links to are named among its params, in "payload".`
            : `Links on an existing card are changed by an operation its type declares for that, or by "update" in "payload".`
        }`,
      );
    }

    let payload = payloadOf(input);
    assertPayloadSuppliesParams(name, declarations[name], payload);

    let member = bucket[name] as (
      payload?: unknown,
      opts?: unknown,
    ) => Promise<OperationWriteResult | Record<string, unknown> | null>;
    let answer = await member(payload, invokeOptions(input, card, mintsACard));
    return await this.resultOf(answer, base);
  }

  // An operation invoked on a type, named by its module and export, which is
  // how a create runs where the realm holds no card of the type to reach it
  // through. Every call here is type-scoped, so each one runs in the realm the
  // caller names: there is no card whose realm it could take instead, and the
  // session's default writable realm is a realm nobody named.
  private async runOnType(
    input: BaseToolModule.InvokeCardOperationInput,
    type: CodeRef,
  ): Promise<BaseToolModule.InvokeCardOperationResult> {
    let name = input.operation;
    if (!isResolvedCodeRef(type)) {
      throw new Error(
        `"type" names a type by its module and export, as {"module": "<module>", "name": "<export>"}`,
      );
    }
    if (!input.realm) {
      throw new Error(
        `"${name}" on ${humanReadable(type)} acts on the type rather than on a card, so no card says which realm it runs in. Name it with "realm": where it runs, and where a card it creates lands.`,
      );
    }
    let Type = await loadOperationType(
      name,
      type,
      input.realm,
      this.loaderService.loader,
    );
    let { base, answer } = await invokeOnType(
      await this.loadOperationsModule(),
      Type,
      name,
      payloadOf(input),
      {
        realm: input.realm,
        relationships: input.relationships as
          | Record<string, unknown>
          | undefined,
        skipIndexWait: input.skipIndexWait,
      },
    );
    return await this.resultOf(
      answer as OperationWriteResult | Record<string, unknown> | null,
      base,
    );
  }

  private async resultOf(
    answer: OperationWriteResult | Record<string, unknown> | null,
    base: BaseOperation,
  ): Promise<BaseToolModule.InvokeCardOperationResult> {
    let commandModule = await this.loadToolModule();
    const { InvokeCardOperationResult } = commandModule;
    if (answer === null) {
      // What a delete reports: the card is gone, so there is no identity left
      // to name and no document left to print.
      return new InvokeCardOperationResult();
    }
    if (!isWrite(base)) {
      return new InvokeCardOperationResult({
        document: answer as Record<string, unknown>,
      });
    }
    let { id, version, generation, indexPending, lastModified } =
      answer as OperationWriteResult;
    return new InvokeCardOperationResult({
      cardId: id,
      version,
      generation,
      indexPending: indexPending === true,
      lastModified,
    });
  }

  private loadOperationsModule(): Promise<typeof OperationsModule> {
    return this.loaderService.loader.import<typeof OperationsModule>(
      '@cardstack/base/operations',
    );
  }
}

// The behavior a name is built on. An author's declaration says which one; a
// base operation carried by the def type is reached under the behavior's own
// name.
// Where a behavior this tool does not invoke is reached instead.
const ELSEWHERE: Partial<Record<BaseOperation, string>> = {
  read: 'Read a card with get-card.',
  update: 'Change a card with patch-fields or patch-card-instance.',
};

// What a minted card is given beside its field values: where it lands, and the
// cards it is created linking to. Both belong to a card being created rather
// than to the invocation, so neither is passed for anything else - which is
// what makes the refusals above the only place they could be silently dropped.
//
// A realm the caller did not name is the realm holding the card that named the
// type, rather than whichever realm the session happens to write to by
// default. The caller named one card and asked for another of its type; that
// card is the only realm they have said anything about, and a create landing
// anywhere else would be a write to a realm nobody mentioned.
function invokeOptions(
  input: BaseToolModule.InvokeCardOperationInput,
  card: CardDef,
  mintsACard: boolean,
): { realm?: string; relationships?: Record<string, unknown> } | undefined {
  if (!mintsACard) {
    return undefined;
  }
  // A realm is always present by the time this runs: a mint with neither a
  // named realm nor a target in one is refused above.
  let realm = input.realm || card[realmURL]?.href;
  let relationships = input.relationships as
    | Record<string, unknown>
    | undefined;
  return {
    ...(realm ? { realm } : {}),
    ...(relationships ? { relationships } : {}),
  };
}

// The type a call names, or none where the caller left it blank. A model
// fills an optional code ref with empty strings as readily as it leaves it
// out, so `{}` and `{ module: '', name: '' }` read as no type rather than as
// one given beside "cardId". A ref with either part filled in is given, and
// one that names no module and export is refused for that.
function givenType(type: CodeRef | null | undefined): CodeRef | undefined {
  if (!type) {
    return undefined;
  }
  let { module, name } = type as { module?: unknown; name?: unknown };
  if (!('type' in type) && !module && !name) {
    return undefined;
  }
  return type;
}

// The payload as the operation reads it. A field the caller left unset arrives
// as an absent value, and an operation that takes no params is invoked with
// none rather than with an empty object, so that a base `create` given nothing
// mints a card with no attributes rather than being told its attributes are
// not an object.
function payloadOf(
  input: BaseToolModule.InvokeCardOperationInput,
): Record<string, unknown> | undefined {
  let payload = input.payload as Record<string, unknown> | null | undefined;
  return payload ?? undefined;
}
