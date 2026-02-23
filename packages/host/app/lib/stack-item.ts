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
  format: Format;
  request?: Deferred<string>;
  stackIndex: number;
  closeAfterSaving?: boolean;
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
      relationshipContext,
    } = args;

    this.#id = id.replace(/\.json$/, '');
    this.format = format;
    this.request = request;
    this.stackIndex = stackIndex;
    this.type = inferStackItemType(type);
    this.closeAfterSaving = closeAfterSaving;
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
    } = this;
    return new StackItem({
      format,
      request,
      closeAfterSaving,
      id,
      type,
      stackIndex,
      relationshipContext,
      ...args,
    });
  }
}
