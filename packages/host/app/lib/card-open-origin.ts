// A single user selection's viewport footprint, carried by its new stack item.
// It is deliberately not persisted or copied when a stack item is cloned.
export interface CardOpenOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  // The source is consumed before navigation, never retained by the stack.
  source?: HTMLElement;
  bitmapKey?: string;
}

// Custom card actions (for example catalog buttons) need no fitted wrapper.
// A click only becomes an origin when viewCard is called during its dispatch.
// The weak return address is scoped to the parent, never an animation match.
const activations = new WeakMap<HTMLElement, Event>();
const returns = new WeakMap<
  HTMLElement,
  { cardId: string; element: WeakRef<HTMLElement> }
>();

export function captureCardActivation(boundary: HTMLElement, event: Event) {
  activations.set(boundary, event);
}

export function cardActionOrigin(
  boundary: HTMLElement | undefined,
  cardId: string,
): CardOpenOrigin | undefined {
  if (!boundary) return;
  let event = activations.get(boundary);
  activations.delete(boundary);
  let live = event && event.eventPhase !== Event.NONE ? event : undefined;
  // A card shown more than once (a fitted tile and an embedded row) is
  // ambiguous by identity alone; the preview that was clicked is the origin.
  let target = live?.target instanceof Node ? live.target : undefined;
  let clicked = target
    ? clickedPreview(target, embeddedCardElements(boundary, cardId), boundary)
    : undefined;
  let embedded = clicked
    ? visibleCardOrigin(clicked, boundary)
    : embeddedCardOrigin(boundary, cardId);
  if (embedded) {
    // A buried parent hides every preview, so the way back would be
    // ambiguous again. Keep the one this card left from.
    if (embedded.source)
      returns.set(boundary, {
        cardId,
        element: new WeakRef(embedded.source),
      });
    return embedded;
  }
  if (!live) return;
  event = live;
  let element =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('button, a[href], [role="button"]')
      : null;
  if (
    !element ||
    !boundary.contains(element) ||
    !element.closest('.stack-item-content')
  )
    return;
  let origin = visibleCardOrigin(element, boundary);
  if (origin) returns.set(boundary, { cardId, element: new WeakRef(element) });
  return origin;
}

// The preview holding the click, or else the one nearest to it: an action
// beside its tile (an open-in-new-stack strip) belongs to that tile.
function clickedPreview(
  target: Node,
  candidates: HTMLElement[],
  boundary: HTMLElement,
) {
  for (let node: Node | null = target; node && node !== boundary; ) {
    let inside = candidates.filter((element) => node!.contains(element));
    if (inside.length === 1) return inside[0];
    if (inside.length > 1) return undefined;
    node = node.parentNode;
  }
  return undefined;
}

export function forgetCardActionOrigin(boundary: HTMLElement, cardId: string) {
  if (returns.get(boundary)?.cardId === cardId) returns.delete(boundary);
}

function actionReturnElement(boundary: HTMLElement, cardId: string) {
  let address = returns.get(boundary);
  let element =
    address?.cardId === cardId ? address.element.deref() : undefined;
  return element && boundary.contains(element) ? element : undefined;
}

// Match only the selected card inside its owning stack item. An index may put
// an open button beside its fitted preview, so the button's ancestors alone
// are not the card identity. Ambiguous or offscreen previews get no match.
export function embeddedCardOrigin(
  boundary: HTMLElement | undefined,
  cardId: string,
): CardOpenOrigin | undefined {
  if (!boundary) return;
  let returned = actionReturnElement(boundary, cardId);
  if (returned) return visibleCardOrigin(returned, boundary);
  let candidates = embeddedCardElements(boundary, cardId)
    .map((element) => visibleCardOrigin(element, boundary))
    .filter((origin) => origin !== undefined);
  return candidates.length === 1 ? candidates[0] : undefined;
}

// A buried card hides its body. Find its unique identity before closing, then
// measure visibility again after the parent has returned to its full layout.
export function embeddedCardElement(boundary: HTMLElement, cardId: string) {
  let returned = actionReturnElement(boundary, cardId);
  if (returned) return returned;
  let candidates = embeddedCardElements(boundary, cardId);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function embeddedCardElements(boundary: HTMLElement, cardId: string) {
  return Array.from(
    boundary.querySelectorAll<HTMLElement>(
      `[data-boxel-card-id="${CSS.escape(cardId.replace(/\.json$/, ''))}"]`,
    ),
  )
    .filter((element) =>
      ['fitted', 'embedded'].includes(element.dataset.boxelCardFormat ?? ''),
    )
    .flatMap(cardSurfaces);
}

// Delegated card layouts often flatten their field wrappers with display:
// contents. Match the one actual surface, never the zero-size identity wrapper.
// Multiple surfaces remain ambiguous, including when resolving a hidden return.
function cardSurfaces(element: HTMLElement): HTMLElement[] {
  if (getComputedStyle(element).display !== 'contents') return [element];
  return Array.from(element.children).flatMap((child) =>
    child instanceof HTMLElement &&
    !['STYLE', 'SCRIPT', 'TEMPLATE'].includes(child.tagName)
      ? cardSurfaces(child)
      : [],
  );
}

export function searchCardOrigin(
  event: Event,
): { cardId: string; origin: CardOpenOrigin } | undefined {
  if (event instanceof KeyboardEvent && event.key !== 'Enter') return;
  let target = event.target;
  let boundary = event.currentTarget;
  if (!(target instanceof Element) || !(boundary instanceof Element)) return;
  let tile = target.closest<HTMLElement>('[data-search-card-id]');
  let cardId = tile?.dataset.searchCardId;
  if (!tile || !cardId || !boundary.contains(tile)) return;
  let origin = visibleCardOrigin(tile, boundary);
  return origin ? { cardId, origin } : undefined;
}

function visibleCardOrigin(
  tile: HTMLElement,
  boundary: Element,
): CardOpenOrigin | undefined {
  if (
    !tile.checkVisibility({ visibilityProperty: true, opacityProperty: true })
  )
    return;
  let box = tile.getBoundingClientRect();
  let left = Math.max(0, box.left);
  let top = Math.max(0, box.top);
  let right = Math.min(window.innerWidth, box.right);
  let bottom = Math.min(window.innerHeight, box.bottom);
  // A partially scrolled tile starts at its visible footprint, not outside
  // the sheet. This also handles horizontal strip results.
  for (let parent = tile.parentElement; parent; parent = parent.parentElement) {
    let style = getComputedStyle(parent);
    // A boxless ancestor cannot clip its descendants, even if it declares
    // overflow:hidden (common on the host's fitted-card wrappers).
    if (style.display === 'contents') continue;
    let rect = parent.getBoundingClientRect();
    if (style.overflowX !== 'visible') {
      left = Math.max(left, rect.left);
      right = Math.min(right, rect.right);
    }
    if (style.overflowY !== 'visible') {
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    if (parent === boundary) break;
  }
  if (right - left < 1 || bottom - top < 1) return;
  return {
    source: tile,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    radius: parseFloat(getComputedStyle(tile).borderTopLeftRadius) || 0,
  };
}
