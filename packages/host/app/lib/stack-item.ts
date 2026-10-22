import { tracked } from '@glimmer/tracking';

import { isFileDefInstance } from '@cardstack/runtime-common';
import type { Deferred } from '@cardstack/runtime-common';
import type { Store, StoreReadType } from '@cardstack/runtime-common';

import { knownFileMetaUrls } from './known-file-meta-urls';

import type { Format } from '@cardstack/base/card-api';

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
  opening?: StackItemOpening;
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
  if (fileMetaInstanceOrError) {
    return 'file';
  }
  // CardsGrid and other prerendered-search consumers click URLs whose
  // file-meta resources may not yet be in the store (prerendered results are
  // HTML-only). `knownFileMetaUrls` is populated as PrerenderedCard wrappers
  // are built, so consulting it covers the common "user clicks a file row in
  // a freshly opened CardsGrid" path.
  if (knownFileMetaUrls.has(cardId)) {
    return 'file';
  }
  return 'card';
}

// Whether a delete on `id` should take the file route rather than the card one.
// A `…/x.json` id names a card's own storage as readily as it names a standalone
// file, and the two want opposite deletes: the source DELETE removes the bytes a
// card is stored in while none of the card cleanup runs — no consumer rewrite to
// the link-not-found placeholder, no recents removal, no stack trim on the card
// id. Nothing available here tells the two apart, so `.json` keeps the card route
// and a card's own row behaves as it always has.
export function takesFileDeleteRoute(
  cardOrURL: unknown,
  id: string | undefined,
  store: Pick<Store, 'peek' | 'peekError'>,
): boolean {
  if (!id || /\.json$/.test(id)) {
    return false;
  }
  return detectStackItemTypeForTarget(cardOrURL, id, store) === 'file';
}

// How a card's opening moves focus in the operator-mode stacks, the way a
// non-modal dialog moves it. An item and its clones share one: a clone
// continues the same card as it moves stacks or takes its saved id.
export class StackItemOpening {
  // What had focus as the card opened, so that closing the card hands focus
  // back. Held weakly, so it doesn't keep a closed opener's DOM alive.
  opener: WeakRef<Element> | undefined;

  // A card takes focus on its first render only, as it opens. Cards restored
  // from the URL start out opened.
  constructor(public opened = false) {}
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
  // Bumped on construction (= a new open), and via `markInteracted()` on
  // every format change and whenever focus enters the item. The format
  // bump is what makes "open A, open B, edit A, Escape" target A: clicking
  // edit on A is the most recent interaction even though B was opened more
  // recently.
  lastInteractedAt: number;
  readonly opening: StackItemOpening;
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
      opening,
    } = args;

    this.type = inferStackItemType(type);
    // CardDef instance ids are stored without a `.json` extension, so the
    // strip sanitizes inputs that erroneously include one. FileDef rows are
    // a different story — their canonical URL keeps the extension
    // (`*.json` for JsonFileDef, `*.md` for MarkdownDef, etc.) and stripping
    // would lose the identity of `.json` FileDef rows in the store.
    this.#id = this.type === 'file' ? id : id.replace(/\.json$/, '');
    this.format = format;
    this.request = request;
    this.stackIndex = stackIndex;
    this.useBaseTemplate = useBaseTemplate;
    this.relationshipContext = relationshipContext;
    this.lastInteractedAt = lastInteractedAt ?? ++nextInteractionSequence;
    this.opening = opening ?? new StackItemOpening();
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
      opening,
    } = this;
    // Preserve the original interaction time and opening so clones (id swap
    // on persist, stack shift on left-neighbor drop) don't masquerade as a
    // fresh interaction and steal precedence, or as a fresh open and take
    // focus.
    return new StackItem({
      format,
      request,
      id,
      type,
      stackIndex,
      relationshipContext,
      useBaseTemplate,
      lastInteractedAt,
      opening,
      ...args,
    });
  }
}
