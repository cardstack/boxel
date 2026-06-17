import {
  capabilities,
  setComponentManager,
  setComponentTemplate,
} from '@ember/component';
import { precompileTemplate } from '@ember/template-compilation';

import type {
  ErrorEntry,
  Format,
  ResolvedCodeRef,
  StoreReadType,
} from '@cardstack/runtime-common';

import HydratableCard, {
  type HydrationMode,
} from '../components/card-search/hydratable-card';

import type { HTMLComponent } from './html-component';
import type { ComponentLike } from '@glint/template';

// A `<SearchResults>` entry's ready-to-render component, curried in JS so each
// entry can carry its own `.component` and consumers invoke `<entry.component
// />` without branching on prerendered-vs-live. It wraps `HydratableCard`,
// which renders the inert HTML for an HTML-backed row and swaps in a live
// `<CardRenderer>` on the hydration gesture, or resolves a full live row
// immediately. Currying through a custom component manager (the same shape
// `html-component.ts` uses) compiles the wrapping template once and varies the
// `HydratableCard` args per entry — context still propagates to the nested
// `HydratableCard` because the glimmer VM tracks provide/consume context per
// component instance regardless of manager.
export interface HydratableEntryArgs {
  // The card/file identity URL — also the hydration GET target.
  cardId: string;
  // The inert prerendered HTML for an HTML-backed row; absent for a full live
  // row, which resolves to its live instance with nothing to stay inert as.
  component?: HTMLComponent;
  // The ancestor type the live/hydrated card renders as, so it matches its
  // prerendered-HTML siblings. Files render natively (undefined).
  renderType?: ResolvedCodeRef;
  // `card` (default) or `file-meta` — the resource type the row resolves to.
  type?: StoreReadType;
  // The format the live/hydrated card renders as, so it matches the
  // prerendered HTML the query selected.
  format: Format;
  // An error rendering never hydrates; with no inert HTML it falls through to
  // the host error component.
  isError: boolean;
  // The error doc the host error component surfaces when this row falls through
  // to it.
  errorDoc?: ErrorEntry;
  // The hydration gesture for an HTML-backed row.
  mode: HydrationMode;
}

class _HydratableEntryComponent {
  constructor(
    readonly cardId: string,
    readonly component: HTMLComponent | undefined,
    readonly renderType: ResolvedCodeRef | undefined,
    readonly type: StoreReadType | undefined,
    readonly format: Format,
    readonly isError: boolean,
    readonly errorDoc: ErrorEntry | undefined,
    readonly mode: HydrationMode,
  ) {}
}

setComponentTemplate(
  precompileTemplate(
    `<HydratableCard
      @cardId={{this.cardId}}
      @component={{this.component}}
      @renderType={{this.renderType}}
      @type={{this.type}}
      @format={{this.format}}
      @isError={{this.isError}}
      @errorDoc={{this.errorDoc}}
      @mode={{this.mode}}
      ...attributes
    />`,
    {
      strictMode: true,
      scope: () => ({ HydratableCard }),
    },
  ),
  _HydratableEntryComponent.prototype,
);

type ComponentManager = ReturnType<Parameters<typeof setComponentManager>[0]>;

class HydratableEntryComponentManager implements ComponentManager {
  capabilities = capabilities('3.13', {});
  static create(_owner: unknown) {
    return new HydratableEntryComponentManager();
  }
  createComponent(entryComponent: _HydratableEntryComponent, _args: unknown) {
    return entryComponent;
  }
  getContext(entryComponent: _HydratableEntryComponent) {
    return entryComponent;
  }
}

setComponentManager(
  (owner) => HydratableEntryComponentManager.create(owner),
  _HydratableEntryComponent.prototype,
);

export type EntryComponent = ComponentLike<{ Element: Element; Args: {} }>;

export function hydratableEntryComponent(
  args: HydratableEntryArgs,
): EntryComponent {
  return new _HydratableEntryComponent(
    args.cardId,
    args.component,
    args.renderType,
    args.type,
    args.format,
    args.isError,
    args.errorDoc,
    args.mode,
  ) as unknown as EntryComponent;
}
