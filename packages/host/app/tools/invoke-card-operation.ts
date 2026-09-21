import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';
import type {
  BaseOperation,
  OperationWriteResult,
} from '@cardstack/runtime-common';
import { isWrite } from '@cardstack/runtime-common/card-operations';

import HostBaseTool from '../lib/host-base-tool';

import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';
import type * as OperationsModule from '@cardstack/base/operations';

// A bucket of callable operations, in the terms a name that arrived as data
// reaches them by. `operations()` is overloaded per scope so a card author
// gets the members their class carries and nothing else; a tool is handed the
// name instead of writing it, so it reads the bucket as the record the
// implementation answers with.
type OperationsBucket = Record<string, unknown>;

// The one member of a card's bucket that is not an operation: it opens a batch
// and takes a builder rather than a payload. One tool call is one operation,
// so it is neither offered nor invocable here.
const BATCH_MEMBER = 'atomic';

export default class InvokeCardOperationTool extends HostBaseTool<
  typeof BaseToolModule.InvokeCardOperationInput,
  typeof BaseToolModule.InvokeCardOperationResult
> {
  @service declare private store: StoreService;

  static actionVerb = 'Invoke';

  description = `Invoke an operation that a card's type declares. An operation is a named action an author defined on the type — "addComment", "invite", "archive" — that the realm carries out in one authorized request, applying the author's own rules. Prefer it over patching a card by hand whenever the type declares one for the change you want; use get-card-type-schema or the card's source to see which names a type carries. "payload" supplies the operation's params and its keys must match the names the operation declares exactly — a missing one is refused before anything is sent. "realm" is read only when the operation creates a card of the target card's type, naming where that new card lands; an operation that acts on the card at "cardId" runs in that card's own realm. A write answers the card it wrote plus its version; a read answers the document.`;

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { InvokeCardOperationInput } = commandModule;
    return InvokeCardOperationInput;
  }

  requireInputFields = ['cardId', 'operation'];

  protected async run(
    input: BaseToolModule.InvokeCardOperationInput,
  ): Promise<BaseToolModule.InvokeCardOperationResult> {
    let card = await this.store.get<CardDef>(input.cardId);
    if (!isCardInstance(card)) {
      throw new Error(
        `cannot invoke "${input.operation}": ${input.cardId} did not load: ${card.message}`,
      );
    }

    let operationsModule = await this.loadOperationsModule();
    let bucketFor = operationsModule.operations as (
      target: unknown,
    ) => OperationsBucket;
    // The two scopes a name can be invocable in, and the order they are
    // consulted in. An instance-scoped member acts on the card the caller
    // named; a type-scoped one — the plain `create` — acts on that card's
    // class, which is how a single card id names a type.
    let onInstance = bucketFor(card);
    let onType = bucketFor(card.constructor);
    let declarations = operationsModule.getDeclaredOperations(card);

    let name = input.operation;
    let scope = scopeOf(name, onInstance, onType);
    if (!scope) {
      throw new Error(
        `"${name}" is not an operation ${displayNameOf(card)} carries. It carries: ${invocableNames(
          onInstance,
          onType,
          declarations,
        ).join(', ')}`,
      );
    }

    let base = baseOf(name, declarations);
    if (base === 'query') {
      throw new Error(
        `"${name}" is a query, which answers a live set of search results rather than a value, so it is not invoked through this tool. Search with search-entries instead.`,
      );
    }
    if (scope === 'instance' && input.realm) {
      throw new Error(
        `"${name}" acts on ${input.cardId} and runs in the realm that holds it, so it cannot be given a realm to run in. A realm names where a card a "create" mints lands.`,
      );
    }

    let payload = payloadOf(input);
    assertPayloadSuppliesParams(name, declarations[name], payload);

    let member = (scope === 'instance' ? onInstance : onType)[name] as (
      payload?: unknown,
      opts?: unknown,
    ) => Promise<OperationWriteResult | Record<string, unknown> | null>;
    let answer = await member(
      payload,
      input.realm ? { realm: input.realm } : undefined,
    );

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
    let { id, version, generation, lastModified } =
      answer as OperationWriteResult;
    return new InvokeCardOperationResult({
      cardId: id,
      version,
      generation,
      lastModified,
    });
  }

  private loadOperationsModule(): Promise<typeof OperationsModule> {
    return this.loaderService.loader.import<typeof OperationsModule>(
      '@cardstack/base/operations',
    );
  }
}

// Which bucket carries the name, if either. A declared create is carried in
// both — invoked on the class it mints a card outright, invoked on an instance
// that instance is the context its declaration reads — and the instance
// reading is what a caller naming a card asked for.
function scopeOf(
  name: string,
  onInstance: OperationsBucket,
  onType: OperationsBucket,
): 'instance' | 'type' | undefined {
  if (name !== BATCH_MEMBER && typeof onInstance[name] === 'function') {
    return 'instance';
  }
  if (typeof onType[name] === 'function') {
    return 'type';
  }
  return undefined;
}

// The behavior a name is built on. An author's declaration says which one; a
// base operation carried by the def type is reached under the behavior's own
// name.
function baseOf(
  name: string,
  declarations: Record<string, OperationsModule.OperationDeclaration>,
): BaseOperation {
  return (declarations[name]?.base ?? name) as BaseOperation;
}

// Every name this tool will invoke on the card, for a caller that named one it
// will not. A query is left out rather than listed and then refused, and so is
// the batch member, which is not an operation.
function invocableNames(
  onInstance: OperationsBucket,
  onType: OperationsBucket,
  declarations: Record<string, OperationsModule.OperationDeclaration>,
): string[] {
  let names = new Set<string>();
  for (let bucket of [onInstance, onType]) {
    for (let name of Object.keys(bucket)) {
      if (name === BATCH_MEMBER || baseOf(name, declarations) === 'query') {
        continue;
      }
      names.add(name);
    }
  }
  return [...names].sort();
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

// Every param the declaration names needs a value, which is the realm's own
// rule for an invocation; asking it here means a caller hears which name it
// left out without a request being sent or a write lock being taken.
//
// A declaration carrying an `input` program is exempt, and that is the whole
// reason this is not a blanket check: `input` runs over the payload before the
// realm's params check and is most often there precisely to supply a param the
// caller did not send, so refusing here would refuse an invocation the realm
// would have carried out.
function assertPayloadSuppliesParams(
  name: string,
  declaration: OperationsModule.OperationDeclaration | undefined,
  payload: Record<string, unknown> | undefined,
): void {
  if (!declaration?.params || declaration.input) {
    return;
  }
  for (let key of Object.keys(declaration.params)) {
    if (own(payload, key) === undefined) {
      throw new Error(
        `operation "${name}" requires a value for params("${key}")`,
      );
    }
  }
}

function own(
  record: Record<string, unknown> | undefined,
  key: string,
): unknown {
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }
  return record[key];
}

function displayNameOf(card: CardDef): string {
  let owner = card.constructor as { displayName?: string; name?: string };
  return owner.displayName || owner.name || 'this card';
}
