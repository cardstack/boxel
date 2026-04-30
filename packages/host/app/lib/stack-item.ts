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
  closeAfterSaving?: boolean;
  useBaseTemplate?: boolean;
  relationshipContext?: {
    fieldName?: string;
    fieldType?: 'linksTo' | 'linksToMany';
  };
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

export class StackItem {
  // `format`, `request`, `closeAfterSaving`, `useBaseTemplate` are
  // tracked so that callers can mutate them IN PLACE (e.g. flipping
  // `format` from 'isolated' → 'edit') without replacing the StackItem
  // instance. Replacing the instance forces Glimmer's `{{#each}}` to
  // destroy and re-mount the entire stack-item subtree — losing scroll
  // position, DOM state, view transitions, and triggering
  // prefersWideFormat to narrow then re-expand. In-place mutation lets
  // shared-template formats (CardDef where `static isolated === static
  // edit`) flip without remounting.
  @tracked format: Format;
  @tracked request?: Deferred<string>;
  @tracked closeAfterSaving?: boolean;
  @tracked useBaseTemplate?: boolean;
  stackIndex: number;
  type: StackItemType;
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
      closeAfterSaving,
      useBaseTemplate,
      relationshipContext,
    } = args;

    this.#id = id.replace(/\.json$/, '');
    this.format = format;
    this.request = request;
    this.stackIndex = stackIndex;
    this.type = inferStackItemType(type);
    this.closeAfterSaving = closeAfterSaving;
    this.useBaseTemplate = useBaseTemplate;
    this.relationshipContext = relationshipContext;
  }

  get id() {
    return this.#id;
  }

  clone(args: Partial<Args>) {
    let {
      id,
      format,
      request,
      closeAfterSaving,
      stackIndex,
      relationshipContext,
      type,
      useBaseTemplate,
    } = this;
    return new StackItem({
      format,
      request,
      closeAfterSaving,
      id,
      type,
      stackIndex,
      relationshipContext,
      useBaseTemplate,
      ...args,
    });
  }
}
