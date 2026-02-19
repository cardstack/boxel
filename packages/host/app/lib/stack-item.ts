import type { Deferred } from '@cardstack/runtime-common';

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

export type StackItemType = 'card' | 'file-meta';

function inferStackItemType(id: string, type?: StackItemType): StackItemType {
  if (type) {
    return type;
  }
  return 'card';
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
    this.type = inferStackItemType(this.#id, type);
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
