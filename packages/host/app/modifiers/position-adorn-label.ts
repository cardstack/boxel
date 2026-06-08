import { autoUpdate } from '@floating-ui/dom';
import { modifier } from 'ember-modifier';

export interface PositionAdornLabelSignature {
  Element: HTMLElement;
  Args: {
    Positional: [cardEl: HTMLElement | undefined];
  };
}

// Builds a modifier that positions an Adorn type-label tab manually
// inside the containing card's footprint, so its slope stays anchored
// to the card and long type-names get truncated with an ellipsis when
// they would otherwise spill past the card's edges. Attach the returned
// modifier to the label element and pass the anchor `cardEl`; the
// boundary resolved by the `getBoundaryElement` baked in here is used
// only to decide whether the tab sits above or below the card.
//
// AdornContext calls this factory with its own boundary resolver and
// yields the resulting `positionLabel` modifier, so consumers go
// through the context (no boundary-walk or class names at the call
// site) and just pass the anchor card.
//
// Behavior:
// - While the natural label width fits the card's interior (card
//   width minus the top-right corner radius plus 4px stroke bleed),
//   the label is anchored top-left at the card; otherwise it pins its
//   right edge to the corner-radius point and grows leftward. (4px
//   hysteresis keeps sub-pixel wobble from flipping the placement
//   decision.)
// - If there isn't room above the card inside the boundary, the label
//   flips below; a [data-side] attribute drives the CSS that mirrors
//   the clip-path vertically so the slope still points toward the
//   card.
// - The label's max-width is capped to the card's own width; CSS
//   text-overflow:ellipsis truncates the type-name rather than letting
//   the label spill past the card tile's edges.
//
// The boundary is resolved from the label itself (the label is always
// rendered inside the AdornContext subtree, whereas the anchor card may
// live in a sibling subtree).
//
// Floating-ui's `autoUpdate` only triggers the re-fire on scroll,
// resize, and ancestor mutations; the placement math is direct because
// floating-ui's flip + shift + size middleware aren't a clean fit for
// the right-anchored-with-truncation pattern.
export function makePositionAdornLabel(
  getBoundaryElement: (el: HTMLElement) => HTMLElement | null,
) {
  return modifier<PositionAdornLabelSignature>(function positionAdornLabel(
    label,
    [cardEl],
  ) {
    if (!cardEl) {
      return undefined;
    }
    let boundary = getBoundaryElement(label);
    if (!boundary) {
      return undefined;
    }

    label.style.position = 'absolute';
    label.style.top = '0';
    label.style.left = '0';

    let update = () => {
      label.style.maxWidth = 'none';
      let labelWidth = label.scrollWidth;
      let labelHeight = label.offsetHeight;

      let cardRect = cardEl.getBoundingClientRect();
      let boundaryRect = boundary.getBoundingClientRect();
      let radius =
        parseFloat(window.getComputedStyle(cardEl).borderTopRightRadius) || 0;
      let availableWithinCard = cardRect.width - radius + 4;
      let wasOverflowing = label.hasAttribute('data-overflow');
      let shouldOverflow = wasOverflowing
        ? !(labelWidth + 4 < availableWithinCard)
        : labelWidth > availableWithinCard;
      if (shouldOverflow) {
        label.setAttribute('data-overflow', '');
      } else {
        label.removeAttribute('data-overflow');
      }

      let spaceAbove = cardRect.top - boundaryRect.top;
      let spaceBelow = boundaryRect.bottom - cardRect.bottom;
      let side: 'top' | 'bottom' =
        spaceAbove >= labelHeight + 2 || spaceAbove >= spaceBelow
          ? 'top'
          : 'bottom';
      label.setAttribute('data-side', side);

      let anchorLeftX: number;
      if (shouldOverflow) {
        let anchorRightX = cardRect.right - (radius - 4);
        let unclampedLeft = anchorRightX - labelWidth;
        // Don't let the label spill past the card tile's own left edge —
        // pin its left edge to the card's left edge plus the 4px stroke
        // bleed (`cardRect.left - 4`, matching the non-overflow anchor)
        // and let text-overflow:ellipsis truncate the type-name so the tab
        // never exceeds the tile's footprint.
        let cardLeftLimit = cardRect.left - 4;
        if (unclampedLeft >= cardLeftLimit) {
          // Natural width fits inside the card — use max-content so the
          // browser sizes to the true intrinsic width (scrollWidth is
          // integer-rounded, so writing it back as `max-width: Npx` would
          // shave a sub-pixel remainder and trip text-overflow:ellipsis
          // even though there's room to spare).
          anchorLeftX = unclampedLeft;
          label.style.maxWidth = 'max-content';
        } else {
          // Label can't fit inside the card at natural width; clamp the
          // un-anchored edge to the card and let the ellipsis show.
          anchorLeftX = cardLeftLimit;
          let width = Math.max(0, anchorRightX - anchorLeftX);
          label.style.maxWidth = width + 'px';
        }
      } else {
        anchorLeftX = cardRect.left - 4;
        label.style.maxWidth = 'max-content';
      }
      // When flipped below, sit the flag's top edge flush with the card's
      // bottom edge — no overlap into the card (any overlap reads as the tag
      // riding too high over the edge), and no gap (its z-index keeps it
      // above the selection outline stroke, so it still reads as attached).
      let anchorTopY =
        side === 'top' ? cardRect.top - labelHeight - 2 : cardRect.bottom;

      // The label's anchor positions (anchorLeftX, anchorTopY) are in
      // viewport coordinates. With `position: absolute`, the inline
      // `left`/`top` write to the offset-parent's local coordinate space
      // — which can be scaled relative to the viewport (e.g.
      // `#ember-testing` applies `scale(0.5)` in the test runner). Read
      // the offset parent's rect vs its unscaled `offsetWidth/
      // offsetHeight` to recover the scale factors, then convert the
      // viewport anchor into the offset parent's local space.
      let offsetParent = label.offsetParent as HTMLElement | null;
      let parentRect = offsetParent
        ? offsetParent.getBoundingClientRect()
        : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      let scaleX =
        offsetParent && offsetParent.offsetWidth > 0
          ? parentRect.width / offsetParent.offsetWidth
          : 1;
      let scaleY =
        offsetParent && offsetParent.offsetHeight > 0
          ? parentRect.height / offsetParent.offsetHeight
          : 1;
      if (!Number.isFinite(scaleX) || scaleX === 0) {
        scaleX = 1;
      }
      if (!Number.isFinite(scaleY) || scaleY === 0) {
        scaleY = 1;
      }
      label.style.left = (anchorLeftX - parentRect.left) / scaleX + 'px';
      label.style.top = (anchorTopY - parentRect.top) / scaleY + 'px';
    };

    return autoUpdate(cardEl, label, update);
  });
}
