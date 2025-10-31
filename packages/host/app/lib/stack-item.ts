import type { Deferred } from '@cardstack/runtime-common';

import type { Format } from 'https://cardstack.com/base/card-api';

interface Args {
  format: Format;
  request?: Deferred<string>;
  stackIndex: number;
  id: string;
  closeAfterSaving?: boolean;
}

export class StackItem {
  format: Format;
  request?: Deferred<string>;
  stackIndex: number;
  closeAfterSaving?: boolean;
  #id: string;

  constructor(args: Args) {
    let { format, request, stackIndex, id, closeAfterSaving } = args;

    this.#id = id.replace(/\.json$/, '');
    this.format = format;
    this.request = request;
    this.stackIndex = stackIndex;
    this.closeAfterSaving = closeAfterSaving;
  }

  get id() {
    return this.#id;
  }

  clone(args: Partial<Args>) {
    let { id, format, request, closeAfterSaving, stackIndex } = this;
    return new StackItem({
      format,
      request,
      closeAfterSaving,
      id,
      stackIndex,
      ...args,
    });
  }
}
