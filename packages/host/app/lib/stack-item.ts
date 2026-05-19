import { tracked } from '@glimmer/tracking';

import { isFileDefInstance } from '@cardstack/runtime-common';
import type { Deferred } from '@cardstack/runtime-common';
import type { Store, StoreReadType } from '@cardstack/runtime-common';

import type { Format } from 'https://cardstack.com/base/card-api';

interface Args {
  format: Format;
  request?: Deferred<string>;
  stackIndex: number;
  id: string;
  type?: StackItemType;
  useBaseTemplate?: boolean;
  relationshipContext?: {
    fieldName?: string;
    fieldType?: 'linksTo' | 'linksToMany';
  };
  lastInteractedAt?: number;
}

export type StackItemType = 'card' | 'file';

function inferStackItemType(type?: StackItemType): StackItemType {
  return type === 'file' ? 'file' : 'card';
}

export function stackItemTypeToStoreReadType(
  type: StackItemType,
): StoreReadType {
  return type === 'file' ? 'file-meta' : 'card';
}

export function detectStackItemTypeForTarget(
  cardOrURL: unknown,
  cardId: string | undefined,
  store: Pick<Store, 'peek' | 'peekError'>,
): StackItemType {
  if (
    cardOrURL &&
    typeof cardOrURL === 'object' &&
    !(cardOrURL instanceof URL)
  ) {
    return isFileDefInstance(cardOrURL) ? 'file' : 'card';
  }
  if (!cardId) {
    return 'card';
  }
  let fileMetaInstanceOrError =
    store.peek(cardId, { type: 'file-meta' }) ??
    store.peekError(cardId, { type: 'file-meta' });
  return fileMetaInstanceOrError ? 'file' : 'card';
}

let nextInteractionSequence = 0;
let nextStackItemInstanceId = 0;

export class StackItem {
  // `format`, `request`, `useBaseTemplate` are tracked so that callers
  // can mutate them IN PLACE (e.g. flipping `format` from 'isolated' →
  // 'edit') without replacing the StackItem instance. Replacing the
  // instance forces Glimmer's `{{#each}}` to destroy and re-mount the
  // entire stack-item subtree — losing scroll position, DOM state,
  // view transitions, and triggering prefersWideFormat to narrow then
  // re-expand. In-place mutation lets shared-template formats (CardDef
  // where `static isolated === static edit`) flip without remounting.
  @tracked format: Format;
  @tracked request?: Deferred<string>;
  @tracked useBaseTemplate?: boolean;
  stackIndex: number;
  type: StackItemType;
  // Monotonic sequence used to identify which item the user most
  // recently touched, for deciding what Escape / Ctrl+E should target.
  // Bumped on construction (= a new open) AND on every format change
  // via `markInteracted()`. The format bump is what makes "open A,
  // open B, edit A, Escape" target A: clicking edit on A is the most
  // recent interaction even though B was opened more recently.
  lastInteractedAt: number;
  readonly instanceId: string;
  #id: string;
  relationshipContext?:
    | {
        fieldName?: string;
        fieldType?: 'linksTo' | 'linksToMany';
      }
    | undefined;

  constructor(args: Args) {
    let {
      format,
      request,
      stackIndex,
      id,
      type,
      useBaseTemplate,
      relationshipContext,
      lastInteractedAt,
    } = args;

    this.#id = id.replace(/\.json$/, '');
    this.format = format;
    this.request = request;
    this.stackIndex = stackIndex;
    this.type = inferStackItemType(type);
    this.useBaseTemplate = useBaseTemplate;
    this.relationshipContext = relationshipContext;
    this.lastInteractedAt = lastInteractedAt ?? ++nextInteractionSequence;
    this.instanceId = `stack-item-${++nextStackItemInstanceId}`;
  }

  get id() {
    return this.#id;
  }

  markInteracted() {
    this.lastInteractedAt = ++nextInteractionSequence;
  }

  clone(args: Partial<Args>) {
    let {
      id,
      format,
      request,
      stackIndex,
      relationshipContext,
      type,
      useBaseTemplate,
      lastInteractedAt,
    } = this;
    // Preserve the original interaction time so clones (id swap on
    // persist, stack shift on left-neighbor drop) don't masquerade as
    // a fresh interaction and steal precedence.
    return new StackItem({
      format,
      request,
      id,
      type,
      stackIndex,
      relationshipContext,
      useBaseTemplate,
      lastInteractedAt,
      ...args,
    });
  }
}
