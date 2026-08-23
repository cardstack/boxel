import type { ExactRealmView } from '@cardstack/runtime-common';

export interface SelectedRealmView {
  realmURL: string;
  view: string;
  exact?: ExactRealmView;
}

let interactiveSelection: SelectedRealmView | undefined;

function injectedPrerenderSelection(): SelectedRealmView | undefined {
  return (
    globalThis as unknown as {
      __boxelRealmView?: { realmURL: string; view: string };
    }
  ).__boxelRealmView;
}

export function selectedRealmView(): SelectedRealmView | undefined {
  return interactiveSelection ?? injectedPrerenderSelection();
}

export function installRealmViewSelection(
  realmURL: string | URL,
  exact: ExactRealmView,
): SelectedRealmView {
  interactiveSelection = {
    realmURL: normalizeRealmURL(realmURL),
    view: exact.indexGenerationHash,
    exact,
  };
  return interactiveSelection;
}

export function restoreRealmViewSelection(
  selection: SelectedRealmView | undefined,
): void {
  interactiveSelection = selection;
}

export function clearRealmViewSelection(): void {
  interactiveSelection = undefined;
}

export function selectedRealmViewForURL(
  target: string | URL,
): SelectedRealmView | undefined {
  let selected = selectedRealmView();
  if (!selected) return undefined;

  let targetURL = new URL(String(target));
  let selectedURL = new URL(selected.realmURL);
  // VirtualNetwork may translate an https Realm to an http test/server URL.
  // The Realm path remains the authority boundary in that case.
  selectedURL.protocol = targetURL.protocol;
  return targetURL.href.startsWith(selectedURL.href) ? selected : undefined;
}

function normalizeRealmURL(realmURL: string | URL): string {
  let url = new URL(String(realmURL));
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
