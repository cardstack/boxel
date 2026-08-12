import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { modifier } from 'ember-modifier';
import {
  arrow,
  autoUpdate,
  computePosition,
  flip,
  hide,
  limitShift,
  offset,
  shift,
  size,
} from '@floating-ui/dom';
import type { Placement, Strategy } from '@floating-ui/dom';

import { SURFACE_LAYERS, type SurfaceLayerTier } from './utils/layer-manager';
import {
  POPOVER_KIND_GLYPHS,
  POPOVER_KIND_LABELS,
  resolvePopoverEscalationTarget,
  type PopoverKind,
  type PopoverAnchoring,
  type PopoverSize,
  type PopoverBackdrop,
  type PopoverElevation,
  type PopoverKeyboardModel,
} from './utils/popover-types';

/**
 * `<Popover>` — anchored floating surface that hosts a focused
 * interaction next to a source element. It RAISES a focused something
 * out of the source's small footprint without taking the user away
 * from the source.
 *
 * **Four orthogonal dimensions** drive the visual + behavioral
 * variant:
 *
 *   kind          'details' | 'edit' | 'tools'
 *   anchoring     'beside' | 'overlay' | 'center'
 *   size          'compact' | 'comfortable' | 'spacious' | 'auto'
 *   backdrop      'none' | 'tint' | 'blur' | 'dim'
 *   elevation     'flat' | 'raised' | 'elevated' | 'floating'
 *
 * Plus `keyboardModel` ('pick' | 'edit') which doesn't paint, but
 * decides what to autofocus + which keystrokes the popover delegates:
 * 'pick' targets a [role=listbox] (arrow-nav keys), 'edit' targets the
 * editor input (typing/caret keys).
 *
 * **What the host owns.** Open / close state, kind state, the
 * actual content (one named block per kind: `<:details>` / `<:edit>`
 * / `<:tools>` — the popover renders the block matching the current
 * `@kind`), what each kind means in the host's domain. The Popover
 * owns positioning, dismissal plumbing (Esc + click-out), focus
 * enter / restore, the per-kind + per-elevation visual chrome, and
 * the optional dim backdrop.
 *
 * **Chrome simplification.** The escalation toolbar is OFF by
 * default. When `canEscalateTo` lists more than the current kind,
 * a single compact glyph button appears in the top-right corner
 * (✎ for edit, ⓘ for details, etc.). One click escalates. No
 * labels, no full toolbar — frees the body for content.
 *
 * **Dependencies.** The only npm import is `@floating-ui/dom`, which
 * is globally available to every Boxel realm card via the host's
 * externals shim — no install step is required to remix this.
 */

// The popover type vocabulary (kind / anchoring / size / backdrop /
// elevation / keyboardModel) plus the kind→glyph / kind→label maps and
// escalation resolver live in ../utils/popover-types.ts (imported above).
// PopoverSignature stays here — it's the component's own args contract.

export interface PopoverSignature {
  Args: {
    /** CSS selector velcro / shadowAnchor uses to find the source. */
    anchor: string;
    /** When false, popover is unmounted. Toggling preserves the
     *  surrounding `<Popover>` invocation so re-opens are cheap. */
    open: boolean;
    /** Popover kind — drives the per-kind chrome variant and selects
     *  which named block renders (`<:details>` / `<:edit>` / `<:tools>`).
     *  Supply a block for every kind reachable via `@kind` or
     *  `@canEscalateTo`; a missing block renders an empty pane. */
    kind: PopoverKind;
    /** How the popover relates to its anchor — the mounting strategy.
     *  'beside' floats beside it (Floating UI), 'overlay' overlays its
     *  box, 'center' is a viewport-centered modal. Default 'beside'.
     *  (Distinct from `@placement`, which is the Floating UI side.) */
    anchoring?: PopoverAnchoring;
    /** Size class. Independent of kind. Default 'compact'. Drives
     *  min / max width + height via CSS variables. */
    size?: PopoverSize;
    /** Surface material. Independent of kind. Default 'none' (solid). */
    backdrop?: PopoverBackdrop;
    /** Elevation tier (shadow + radius). Independent of kind/anchoring.
     *  Default 'raised'. */
    elevation?: PopoverElevation;
    /** Which inner control the popover focuses on open + delegates keys
     *  to: 'pick' (a [role=listbox], arrow-navigated) or 'edit' (the
     *  editor input). Default 'edit'. Also exposed as a data attribute
     *  for inner primitives to read. */
    keyboardModel?: PopoverKeyboardModel;
    /** Stable per-open token. Re-renders of the same open popover keep
     *  this token so autofocus runs once for the open interaction,
     *  not after every source-data update. */
    focusToken?: string | number;
    /** Move DOM focus into the popover on open + restore on close.
     *  Default true except for `details` kind. */
    autoFocus?: boolean;
    /** Trap Tab focus inside the popover (aria-modal behaviour). Off by
     *  default — turn on for editor popovers that own the focus cycle. */
    trapFocus?: boolean;
    /** Optional kinds the user can escalate to. When the array
     *  contains kinds OTHER than the current `@kind`, a corner
     *  escalation glyph button appears. Single-kind contracts
     *  (just the current kind) get NO chrome. */
    canEscalateTo?: PopoverKind[];
    /** Fired when the user clicks an escalation glyph. */
    onEscalate?: (next: PopoverKind) => void;
    /** Fired on Esc / outside-click. Host sets `@open=false`. */
    onDismiss?: () => void;
    /** Optional explicit surface layer tier. Defaults from placement/elevation. */
    layerTier?: SurfaceLayerTier;
    /** Optional fixed z-index for hosts that already allocated a layer. */
    zIndex?: number;
    /** Floating UI placement — the preferred side + alignment (e.g.
     *  'bottom-start', 'top-end'). Only used when anchoring is
     *  'beside'. Default 'bottom-start'. */
    placement?: Placement;
    /** Gap in px between the anchor and the popover (Floating UI's
     *  `offset`). Only used when anchoring is 'beside'. Default 8. */
    offset?: number;
    /** Show a small caret pointing at the anchor. Only for 'beside'
     *  anchoring (Floating UI's `arrow` middleware). Default false. */
    arrow?: boolean;
    /** ARIA role for the popover root. Default derived from kind:
     *  'details' → 'tooltip', everything else → 'dialog'. */
    role?: string;
    /** Accessible name (sets aria-label). Prefer `@labelledby` when the
     *  body already has a visible heading element. */
    label?: string;
    /** id of the element labeling the popover (sets aria-labelledby). */
    labelledby?: string;
    /** id of the element describing the popover (sets aria-describedby). */
    describedby?: string;
    /** Visual scale multiplier for the popover surface. Generalizes
     *  the "scale of the rendering environment" — used by any
     *  scalable host (canvas zoom, 3D scene camera distance) to scale
     *  the popover in lockstep with how the rest of the host's content
     *  is being scaled.
     *
     *  The host computes a DAMPED multiplier (the popover shouldn't
     *  scale 1:1 with the env — at canvas zoom 0.25 you don't want
     *  a popover at 25% of normal size, you want it noticeably
     *  smaller but still readable).
     *
     *  Applied via a `transform: scale(...)` with the origin pinned to
     *  the top-left corner so velcro's anchor positioning still reads
     *  the new bbox correctly. Default 1 (no scaling — viewport scale).
     *
     *  IGNORED for `'center'` placement (modal popovers are centered on
     *  the viewport, not anchored to scalable host content; they
     *  always render at viewport scale). */
    relativeScale?: number;
  };
  Blocks: {
    details: [];
    edit: [];
    tools: [];
  };
  Element: HTMLDivElement;
}

/** Esc / click-out dismiss modifier.
 *
 *  Capture-phase listeners — they fire BEFORE any bubble-phase
 *  handler in the popover body OR in the host's surrounding shell.
 *  Both paths call `stopPropagation()` so the same Esc / pointerdown
 *  doesn't ALSO trigger the host's grid-key handler (clearing cell
 *  focus) or the next cell's openEdit (when the user clicked from
 *  one popover directly into another cell). The popover owns dismissal,
 *  full stop. */
const dismissOnOutside = modifier(
  (_el: HTMLElement, [onDismiss]: [(() => void) | undefined]) => {
    if (!onDismiss) return;
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Element | null;
      if (!target) return;
      // Click inside any popover body OR on a popover anchor — let it
      // through (the anchor click reopens a fresh popover; the body
      // click is interactive). Otherwise the click is "outside" —
      // dismiss + don't let the click also fire other handlers
      // (e.g., a sibling cell's onSelect). Without this, clicking
      // from one cell's open popover into another cell would close
      // popover A then immediately open popover B with stale focus.
      if (target.closest('[data-bx-popover]')) return;
      if (target.closest('[data-bx-popover-anchor]')) return;
      // ember-power-select renders its dropdown options in a portal at
      // document.body — treat that portal as "inside" so picking an
      // option from a BoxelSelect within the popover does not dismiss it.
      if (target.closest('.ember-basic-dropdown-content')) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // Stop here — don't let Esc bubble past the popover to the
        // host's keyboard handler (which would clear cell focus
        // OR cancel an unrelated state). Esc inside a popover means
        // ONE thing: close THIS popover.
        event.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  },
);

const allocatePopoverLayer = modifier(
  (
    element: HTMLElement,
    [tier, fixedZIndex]: [SurfaceLayerTier, number | undefined],
  ) => {
    const z = fixedZIndex ?? SURFACE_LAYERS.allocate(tier);
    element.style.setProperty('--bx-popover-z', String(z));
    element.dataset['surfaceLayerTier'] = tier;
    element.dataset['surfaceLayerZ'] = String(z);

    return () => {
      if (fixedZIndex === undefined) {
        SURFACE_LAYERS.release(z);
      }
      element.style.removeProperty('--bx-popover-z');
      delete element.dataset['surfaceLayerTier'];
      delete element.dataset['surfaceLayerZ'];
    };
  },
);

/** Theme tokens the popover carries across its portal.
 *
 *  Theme CSS variables are scoped to the CardContainer of the themed
 *  card (extractCssVariables applies the `:root` block there, not to
 *  the real document root). The popover portals into document.body —
 *  outside that scope — so a plain `var(--popover)` on the portaled
 *  root would resolve to nothing. This modifier reads the RESOLVED
 *  values from the anchor element (which lives inside the themed card)
 *  and copies them onto the portaled root as inline custom properties,
 *  so the popover follows whatever theme governs its anchor — including
 *  dark mode and Brand Guide custom variables. */
const POPOVER_THEME_BRIDGE_TOKENS = [
  /* semantic theme tokens (shadcn vocabulary) */
  '--popover',
  '--popover-foreground',
  '--foreground',
  '--background',
  '--border',
  '--primary',
  '--muted-foreground',
  '--radius',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-xl',
  '--font-sans',
  /* popover-specific knobs a host or theme may set (e.g. via Brand
   * Guide custom variables) */
  '--bx-popover-bg',
  '--bx-popover-fg',
  '--bx-popover-fg-muted',
  '--bx-popover-border',
  '--bx-popover-accent',
  '--bx-popover-dim-bg',
  '--bx-popover-bg-tint',
  '--bx-popover-bg-blur',
  '--bx-popover-tools-bg',
  '--bx-popover-tools-fg',
  '--bx-popover-edit-bg',
  '--bx-popover-edit-border',
  '--bx-popover-radius',
  '--bx-popover-shadow-raised',
  '--bx-popover-shadow-elevated',
  '--bx-popover-shadow-floating',
  '--bx-popover-font-family',
  '--bx-popover-size-compact-min-w',
  '--bx-popover-size-compact-max-w',
  '--bx-popover-size-compact-max-h',
  '--bx-popover-size-comfortable-min-w',
  '--bx-popover-size-comfortable-max-w',
  '--bx-popover-size-comfortable-max-h',
  '--bx-popover-size-spacious-min-w',
  '--bx-popover-size-spacious-max-w',
  '--bx-popover-size-spacious-max-h',
];

const bridgeThemeVariables = modifier(
  (element: HTMLElement, [selector]: [string]) => {
    const anchor = document.querySelector<HTMLElement>(selector);
    if (!anchor) return;
    const computed = getComputedStyle(anchor);
    const applied: string[] = [];
    for (const token of POPOVER_THEME_BRIDGE_TOKENS) {
      const value = computed.getPropertyValue(token).trim();
      if (value) {
        element.style.setProperty(token, value);
        applied.push(token);
      }
    }
    return () => {
      for (const token of applied) {
        element.style.removeProperty(token);
      }
    };
  },
);

/** Marks the portaled root with the surface mode / inspect / portaled
 *  attributes hosts and theming may key off. In this standalone build
 *  it no longer registers with a focus ladder or surface runtime —
 *  mode / inspect default to 'use' / false and can be passed
 *  explicitly when a host wants to drive them. */
const popoverSurfaceRoot = modifier(
  (
    element: HTMLElement,
    _positional: [],
    named: {
      mode?: 'use' | 'change' | 'inspect';
      inspect?: boolean;
    },
  ) => {
    const priorMode = element.getAttribute('data-surface-mode');
    const priorInspect = element.getAttribute('data-surface-inspect');
    element.setAttribute('data-surface-mode', named.mode ?? 'use');
    element.setAttribute(
      'data-surface-inspect',
      String(named.inspect ?? false),
    );
    element.setAttribute('data-surface-portaled-root', 'popover');

    return () => {
      element.removeAttribute('data-surface-portaled-root');
      if (priorMode === null) element.removeAttribute('data-surface-mode');
      else element.setAttribute('data-surface-mode', priorMode);
      if (priorInspect === null)
        element.removeAttribute('data-surface-inspect');
      else element.setAttribute('data-surface-inspect', priorInspect);
    };
  },
);

/** Shadow-anchor modifier — overlays the popover on the anchor's bbox.
 *  Sets top / left / min-width from anchor's getBoundingClientRect.
 *  Clamps to the viewport: if the popover's natural width would extend
 *  past the right edge, shifts left to keep the right edge inside. */
const shadowAnchor = modifier((element: HTMLElement, [selector]: [string]) => {
  const anchorEl = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(selector);
  const update = (): void => {
    const a = anchorEl();
    if (!a) return;
    const r = a.getBoundingClientRect();
    // Reset position-related styles before measuring so a previous
    // run's shifts don't pollute the new computation.
    element.style.position = 'absolute';
    element.style.top = `${window.scrollY + r.top}px`;
    element.style.left = `${window.scrollX + r.left}px`;
    element.style.minWidth = `${Math.round(r.width)}px`;
    // Now measure the popover's actual width (after layout settled
    // with the new min-width applied) and clamp to viewport.
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
    requestAnimationFrame(() => {
      const lr = element.getBoundingClientRect();
      const overflowRight = lr.right - window.innerWidth + 8; // 8px gutter
      if (overflowRight > 0) {
        const newLeft = window.scrollX + r.left - overflowRight;
        element.style.left = `${Math.max(window.scrollX + 8, newLeft)}px`;
      }
      // Same for vertical — if extending past viewport bottom,
      // shift up so we don't get cut off.
      const overflowBottom = lr.bottom - window.innerHeight + 8;
      if (overflowBottom > 0) {
        const newTop = window.scrollY + r.top - overflowBottom;
        element.style.top = `${Math.max(window.scrollY + 8, newTop)}px`;
      }
    });
  };
  update();
  const ro = new ResizeObserver(update);
  const a = anchorEl();
  if (a) ro.observe(a);
  window.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);
  return (): void => {
    ro.disconnect();
    window.removeEventListener('scroll', update, true);
    window.removeEventListener('resize', update);
  };
});

const anchoredPopover = modifier(
  (
    floatingElement: HTMLElement,
    [selector]: [string],
    {
      placement = 'bottom',
      offsetOptions = 8,
      strategy = 'fixed',
    }: {
      placement?: Placement;
      offsetOptions?: number;
      strategy?: Strategy;
    } = {},
  ) => {
    let frame = 0;
    let destroyed = false;
    let lastTop = '';
    let lastLeft = '';
    let lastVisibility = '';

    const referenceElement = (): HTMLElement | SVGElement | null =>
      document.querySelector<HTMLElement | SVGElement>(selector);

    // Round to whole device pixels so text stays crisp on hi-DPI
    // screens (a fractional `top`/`left` blurs the subpixel-rendered
    // glyphs). Per Floating UI's positioning guidance.
    const roundByDPR = (value: number): number => {
      const dpr = window.devicePixelRatio || 1;
      return Math.round(value * dpr) / dpr;
    };

    // Floating UI's required baseline for a floating element:
    // `width: max-content` so the box sizes to its content INSTEAD of
    // wrapping against whatever width its current position happens to
    // allow — wrapping would corrupt the measured rect and drift the
    // anchor. The size-class `min/max-width` still cap it.
    Object.assign(floatingElement.style, {
      position: strategy,
      width: 'max-content',
      top: '0px',
      left: '0px',
      margin: '0',
    });

    const apply = (top: string, left: string, visibility: string): void => {
      if (
        top === lastTop &&
        left === lastLeft &&
        visibility === lastVisibility
      ) {
        return;
      }

      lastTop = top;
      lastLeft = left;
      lastVisibility = visibility;
      Object.assign(floatingElement.style, {
        top,
        left,
        margin: '0',
        visibility,
      });
    };

    const update = async (): Promise<void> => {
      frame = 0;
      const reference = referenceElement();
      if (!reference) {
        apply(lastTop || '0px', lastLeft || '0px', 'hidden');
        return;
      }

      // Host opts into an arrow by rendering an element with this
      // marker inside the popover (only the 'beside' branch does).
      const arrowEl = floatingElement.querySelector<HTMLElement>(
        '[data-bx-popover-arrow]',
      );

      // Order matters: offset first (others build on the offset coords),
      // then flip, then shift to nudge back into view, then size to cap
      // height to the space that's actually left, then arrow (positions
      // against the settled coords), and finally hide to detect a clipped
      // anchor. Every overflow-detecting middleware shares 8px padding.
      const middleware = [
        offset(offsetOptions),
        flip({ fallbackAxisSideDirection: 'end', padding: 8 }),
        shift({ limiter: limitShift(), padding: 8 }),
        size({
          padding: 8,
          apply({ availableHeight }) {
            floatingElement.style.setProperty(
              '--bx-popover-avail-h',
              `${Math.max(0, Math.floor(availableHeight))}px`,
            );
          },
        }),
      ];
      if (arrowEl) {
        // padding keeps the arrow from reaching the rounded corners.
        middleware.push(arrow({ element: arrowEl, padding: 6 }));
      }
      middleware.push(hide({ strategy: 'referenceHidden', padding: 8 }));

      const {
        middlewareData,
        placement: resolvedPlacement,
        x,
        y,
      } = await computePosition(reference, floatingElement, {
        middleware,
        placement,
        strategy,
      });
      if (destroyed) return;

      apply(
        `${roundByDPR(y)}px`,
        `${roundByDPR(x)}px`,
        middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
      );

      // Position the arrow on the side facing the anchor. Floating UI
      // gives the arrow's offset along the popover edge (x for top/bottom
      // placements, y for left/right); we pin the perpendicular side so
      // the arrow pokes out toward the reference.
      if (arrowEl && middlewareData.arrow) {
        const { x: arrowX, y: arrowY } = middlewareData.arrow;
        const side = resolvedPlacement.split('-')[0];
        const staticSide =
          { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[
            side
          ] ?? 'bottom';
        for (const edge of ['top', 'right', 'bottom', 'left']) {
          arrowEl.style.removeProperty(edge);
          arrowEl.style.removeProperty(`border-${edge}`);
        }
        if (arrowX != null) arrowEl.style.left = `${roundByDPR(arrowX)}px`;
        if (arrowY != null) arrowEl.style.top = `${roundByDPR(arrowY)}px`;
        arrowEl.style.setProperty(staticSide, '-6px');

        // CSS border-triangle technique — no rotation, no clip-path.
        // A zero-size element with two transparent borders and one
        // coloured border produces a clean triangle in any direction.
        // staticSide is the card edge the arrow is pinned to; the tip
        // points in the OPPOSITE direction (toward the anchor).
        arrowEl.style.setProperty('transform', 'none');
        arrowEl.style.setProperty('background', 'none');
        arrowEl.style.setProperty('clip-path', 'none');
        arrowEl.style.setProperty('width', '0');
        arrowEl.style.setProperty('height', '0');
        const fill = 'var(--bx-popover-bg, #fff)';
        const none = '0';
        const solid = `7px solid ${fill}`;
        const clear = '7px solid transparent';
        const triangles: Record<string, Record<string, string>> = {
          top: {
            'border-top': none,
            'border-right': clear,
            'border-bottom': solid,
            'border-left': clear,
          },
          bottom: {
            'border-top': solid,
            'border-right': clear,
            'border-bottom': none,
            'border-left': clear,
          },
          left: {
            'border-top': clear,
            'border-right': solid,
            'border-bottom': clear,
            'border-left': none,
          },
          right: {
            'border-top': clear,
            'border-right': none,
            'border-bottom': clear,
            'border-left': solid,
          },
        };
        const t = triangles[staticSide];
        if (t) {
          for (const [prop, val] of Object.entries(t)) {
            arrowEl.style.setProperty(prop, val);
          }
        }
      }
    };

    const schedule = (): void => {
      if (frame !== 0) return;
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
      frame = requestAnimationFrame(() => {
        void update();
      });
    };

    schedule();
    const reference = referenceElement();
    const cleanup = reference
      ? autoUpdate(reference, floatingElement, schedule, {
          ancestorResize: true,
          ancestorScroll: true,
          elementResize: true,
          // Follow the anchor when surrounding layout shifts it
          // (content added above it, a sibling expanding) — not just
          // on scroll/resize. animationFrame stays off: it polls every
          // frame and is only needed for continuously-animating anchors.
          layoutShift: true,
          animationFrame: false,
        })
      : undefined;

    return (): void => {
      destroyed = true;
      cancelAnimationFrame(frame);
      cleanup?.();
    };
  },
);

/** Focus-management modifier. Auto-focuses first focusable in body
 *  on mount; restores DOM focus to the closest focusable ancestor
 *  of the anchor on unmount. */
const focusedPopoverTokens = new Set<string>();

function popoverFocusableSelector(): string {
  return [
    'button:not([disabled]):not([tabindex="-1"])',
    'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"])',
    'select:not([disabled]):not([tabindex="-1"])',
    'textarea:not([disabled]):not([tabindex="-1"])',
    '[contenteditable=""]:not([tabindex="-1"])',
    '[contenteditable="true"]:not([tabindex="-1"])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
}

function popoverEditorSelector(): string {
  return [
    'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"])',
    'textarea:not([disabled]):not([tabindex="-1"])',
    'select:not([disabled]):not([tabindex="-1"])',
    '[contenteditable=""]:not([tabindex="-1"])',
    '[contenteditable="true"]:not([tabindex="-1"])',
  ].join(',');
}

function visibleFocusables(element: HTMLElement): HTMLElement[] {
  return Array.from(
    element.querySelectorAll<HTMLElement>(popoverFocusableSelector()),
  ).filter((candidate) => {
    if (!candidate.isConnected) return false;
    if (candidate.closest('[inert]')) return false;
    const rects = candidate.getClientRects();
    return rects.length > 0 || candidate === document.activeElement;
  });
}

function firstPopoverFocusTarget(element: HTMLElement): HTMLElement | null {
  const body =
    element.querySelector<HTMLElement>('.bx-popover__body') ?? element;
  const keyboardModel = element.getAttribute('data-bx-popover-keyboard-model');
  if (keyboardModel === 'pick') {
    const listbox = body.querySelector<HTMLElement>(
      '[role="listbox"]:not([tabindex="-1"])',
    );
    if (listbox) return listbox;
  }
  const autofocus = body.querySelector<HTMLElement>('[autofocus]');
  if (autofocus) return autofocus;
  if (keyboardModel === 'edit') {
    const editor = body.querySelector<HTMLElement>(popoverEditorSelector());
    if (editor) return editor;
  }
  return body.querySelector<HTMLElement>(popoverFocusableSelector());
}

function focusPopoverTarget(target: HTMLElement): void {
  target.focus({ preventScroll: true });
  if (target instanceof HTMLInputElement) {
    if (
      target.type === 'text' ||
      target.type === 'number' ||
      target.type === 'search' ||
      target.type === 'url' ||
      target.type === 'tel' ||
      target.type === 'email' ||
      target.type === 'password'
    ) {
      target.select();
    }
  } else if (target instanceof HTMLTextAreaElement) {
    target.select();
  }
}

type ReroutedKeyboardEvent = KeyboardEvent & {
  __boxelPopoverKeyboardRerouted?: true;
};

function isPlainTextKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
  );
}

function isPickerNavigationKey(event: KeyboardEvent): boolean {
  return (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowUp' ||
    event.key === 'Home' ||
    event.key === 'End' ||
    event.key === 'Enter' ||
    event.key === 'Tab' ||
    event.key === ' ' ||
    event.key === 'Spacebar' ||
    isPlainTextKey(event)
  );
}

function isEditingKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return (
    event.key === 'Enter' ||
    event.key === 'Tab' ||
    event.key.startsWith('Arrow') ||
    event.key === 'Home' ||
    event.key === 'End' ||
    event.key === 'PageUp' ||
    event.key === 'PageDown' ||
    event.key === 'Backspace' ||
    event.key === 'Delete' ||
    isPlainTextKey(event)
  );
}

function popoverKeyboardModelOwnsEvent(
  element: HTMLElement,
  event: KeyboardEvent,
): boolean {
  const keyboardModel = element.getAttribute('data-bx-popover-keyboard-model');
  if (keyboardModel === 'pick') return isPickerNavigationKey(event);
  if (keyboardModel === 'edit') return isEditingKey(event);
  return false;
}

function topmostKeyboardPopover(): HTMLElement | null {
  const popovers = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-bx-popover][data-bx-popover-keyboard-lock="true"]',
    ),
  );
  return (
    popovers.sort((a, b) => {
      const za = Number(a.dataset['surfaceLayerZ'] ?? 0);
      const zb = Number(b.dataset['surfaceLayerZ'] ?? 0);
      return zb - za;
    })[0] ?? null
  );
}

function cloneKeyboardEvent(event: KeyboardEvent): ReroutedKeyboardEvent {
  const next = new KeyboardEvent(event.type, {
    key: event.key,
    code: event.code,
    location: event.location,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    isComposing: event.isComposing,
    bubbles: true,
    cancelable: true,
  }) as ReroutedKeyboardEvent;
  next.__boxelPopoverKeyboardRerouted = true;
  return next;
}

const popoverFocusModifier = modifier(
  (
    element: HTMLElement,
    [focusToken]: [string | number | undefined],
    { enabled = true }: { enabled?: boolean } = {},
  ) => {
    if (!enabled) return;
    const initial = document.activeElement as HTMLElement | null;
    const previouslyFocused =
      initial && initial !== document.body ? initial : null;
    const token = focusToken === undefined ? undefined : String(focusToken);
    let frame = 0;
    let attempts = 0;
    const focusWhenReady = (): void => {
      if (token && focusedPopoverTokens.has(token)) return;
      // Pick model: prefer the LISTBOX (Spotlight idiom). Compose
      // model: prefer the editor's own input (calendar's date input,
      // formula builder's expression box). Other models: first
      // focusable wins.
      const target = firstPopoverFocusTarget(element);
      if (!target) {
        if (attempts++ < 4) {
          // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
          frame = requestAnimationFrame(focusWhenReady);
        }
        return;
      }
      focusPopoverTarget(target);
      if (token) focusedPopoverTokens.add(token);
    };
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
    frame = requestAnimationFrame(focusWhenReady);
    const anchorSelector = element.getAttribute(
      'data-bx-popover-anchor-selector',
    );
    return (): void => {
      cancelAnimationFrame(frame);
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('[data-bx-popover]')) return;
      const focusEscaped =
        active !== null &&
        active !== document.body &&
        !element.contains(active);
      if (focusEscaped) return;
      const isFocusable = (el: HTMLElement): boolean => {
        if (el.hasAttribute('disabled')) return false;
        const tag = el.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          tag === 'BUTTON' ||
          tag === 'A'
        ) {
          return true;
        }
        if (el.hasAttribute('contenteditable')) return true;
        const ti = el.getAttribute('tabindex');
        if (ti !== null && ti !== '-1') return true;
        return false;
      };
      const findFocusable = (start: HTMLElement | null): HTMLElement | null => {
        let cur: HTMLElement | null = start;
        while (cur && cur !== document.body) {
          if (isFocusable(cur)) return cur;
          cur = cur.parentElement;
        }
        return start;
      };
      let restoreTo: HTMLElement | null = null;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        restoreTo = isFocusable(previouslyFocused)
          ? previouslyFocused
          : findFocusable(previouslyFocused);
      }
      if (!restoreTo && anchorSelector) {
        const anchor = document.querySelector<HTMLElement>(anchorSelector);
        restoreTo = findFocusable(anchor);
      }
      if (!restoreTo) return;
      restoreTo.focus();
      setTimeout(() => {
        if (restoreTo && document.contains(restoreTo)) restoreTo.focus();
      }, 0);
    };
  },
);

/** Delegates stale-focus keyboard events into the active popover body.
 *
 *  While an edit/tools popover is open, Arrow/Enter/Space/type-ahead
 *  belong to the lifted control, even if the browser still reports
 *  DOM focus on the source cell or parent grid. The popover focuses its
 *  negotiated target (`keyboardModel="pick"` prefers the listbox;
 *  `"edit"` prefers the editor input) and re-dispatches a cloned
 *  key event there. Host grids should see neither the stale event nor
 *  a parent navigation command.
 */
const delegatePopoverKeyboardModifier = modifier(
  (
    element: HTMLElement,
    _positional: never[],
    { enabled = true }: { enabled?: boolean } = {},
  ) => {
    if (!enabled) return;

    const onKeydown = (event: KeyboardEvent): void => {
      const routed = event as ReroutedKeyboardEvent;
      if (routed.__boxelPopoverKeyboardRerouted) return;
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') return;
      if (topmostKeyboardPopover() !== element) return;

      const target = event.target instanceof Element ? event.target : null;
      const active =
        document.activeElement instanceof Element
          ? document.activeElement
          : null;
      // Treat ember-power-select's portal as logically inside the popover —
      // keystrokes in its search/options must NOT be hijacked by the popover.
      const insidePopover = (node: Element): boolean => {
        if (element.contains(node)) return true;
        if (node.closest('.ember-basic-dropdown-content')) return true;
        return false;
      };
      if (target && insidePopover(target)) return;
      if (active && insidePopover(active)) return;
      if (!popoverKeyboardModelOwnsEvent(element, event)) return;

      const delegateTarget = firstPopoverFocusTarget(element);
      if (!delegateTarget) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      focusPopoverTarget(delegateTarget);
      delegateTarget.dispatchEvent(cloneKeyboardEvent(event));
    };

    window.addEventListener('keydown', onKeydown, true);
    return () => window.removeEventListener('keydown', onKeydown, true);
  },
);

/** Keeps edit/center popovers in control of DOM focus while they are open.
 *
 *  Surface selection remains on the source coordinate; the popover owns
 *  the active editor. This mirrors grid/canvas lifted editing: Tab
 *  cycles inside the raised editor, and any programmatic focus steal
 *  back to the source is corrected on the next focusin/frame. */
const trapPopoverFocusModifier = modifier(
  (
    element: HTMLElement,
    _positional: never[],
    { enabled = true }: { enabled?: boolean } = {},
  ) => {
    if (!enabled) return;

    let lastFocused: HTMLElement | null = null;
    let allowOutsideFocusUntil = 0;

    const focusFallback = (): void => {
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
      requestAnimationFrame(() => {
        if (!element.isConnected) return;
        if (
          document.activeElement instanceof Element &&
          element.contains(document.activeElement)
        ) {
          return;
        }
        const target =
          (lastFocused?.isConnected && element.contains(lastFocused)
            ? lastFocused
            : null) ?? firstPopoverFocusTarget(element);
        target?.focus({ preventScroll: true });
      });
    };

    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const focusables = visibleFocusables(element);
      if (focusables.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const active = document.activeElement as HTMLElement | null;
      const currentIndex = active ? focusables.indexOf(active) : -1;
      const nextIndex =
        currentIndex === -1
          ? 0
          : event.shiftKey
            ? (currentIndex - 1 + focusables.length) % focusables.length
            : (currentIndex + 1) % focusables.length;
      const next = focusables[nextIndex];
      if (!next) return;
      lastFocused = next;
      next.focus({ preventScroll: true });
    };

    // Treat ember-power-select's portal (rendered at document.body) as
    // logically inside the popover — its dropdown options sit outside our
    // element subtree but represent interaction with our content.
    const isInsideOrPortal = (target: Element): boolean => {
      if (element.contains(target)) return true;
      if (target.closest('.ember-basic-dropdown-content')) return true;
      return false;
    };

    const onFocusin = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (isInsideOrPortal(target)) {
        lastFocused = target;
        return;
      }
      if (Date.now() < allowOutsideFocusUntil) return;
      focusFallback();
    };

    const onPointerdown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && isInsideOrPortal(target)) return;
      // Outside pointerdown is normally a dismiss gesture. Give the
      // close path a short window so the trap does not fight the
      // user's intentional click outside the popover.
      allowOutsideFocusUntil = Date.now() + 250;
    };

    element.addEventListener('keydown', onKeydown, true);
    window.addEventListener('focusin', onFocusin, true);
    window.addEventListener('pointerdown', onPointerdown, true);

    return () => {
      element.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('focusin', onFocusin, true);
      window.removeEventListener('pointerdown', onPointerdown, true);
    };
  },
);

let nextPopoverInstanceId = 0;

const cleanupClosedPopoverModifier = modifier(
  (_element: HTMLElement, [open, instanceId]: [boolean, string]) => {
    let frame = 0;
    if (!open) {
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
      frame = requestAnimationFrame(() => {
        for (const stale of document.querySelectorAll<HTMLElement>(
          `[data-bx-popover-instance="${instanceId}"]`,
        )) {
          stale.remove();
        }
      });
    }

    return () => {
      cancelAnimationFrame(frame);
    };
  },
);

export default class Popover extends Component<PopoverSignature> {
  readonly instanceId = `bx-popover-${++nextPopoverInstanceId}`;

  // ─── arg defaults ───────────────────────────────────────────────

  get portalTarget(): HTMLElement {
    if (typeof document === 'undefined') {
      throw new Error('<Popover> requires a browser document to portal into.');
    }
    // Portal into the host's submode layout, NOT document.body and NOT the
    // operator-mode root. The reason is stacking context, not z-index value:
    //
    //   .operator-mode (position: fixed)         ← own stacking context
    //     .submode-layout (position: relative;   ← own stacking context @ z:0
    //                      z-index: 0)
    //       …the card stack (z ~1–10)            ← the card we belong to
    //       …host in-submode popups              ← profile (z 1001), top-bar
    //                                              (700), AI panel (900) …
    //     CardChooserModal / boxel modals (z 1500 / 2000)
    //
    // The card we float over AND the host's in-submode popups (profile,
    // top-bar, AI panel) both live INSIDE .submode-layout. Portaling any
    // higher (operator-mode or body) puts the popover at a level that paints
    // OVER the whole .submode-layout subtree — so it covers those host
    // popups no matter how small its z-index is (their z is trapped inside
    // submode-layout's z:0 context). Portaling INTO .submode-layout puts the
    // popover in the same stacking context as them, so its compressed tier
    // (z < 200, see SurfaceLayerManager) correctly sits ABOVE the card stack
    // yet BELOW every host surface — the in-submode popups here, and the
    // operator-mode-level modals (which sit above the whole submode subtree).
    // Falls back outward when a level is absent (code mode, standalone, tests).
    return (
      document.querySelector<HTMLElement>('.submode-layout') ??
      document.querySelector<HTMLElement>('.operator-mode') ??
      document.body
    );
  }

  get effectivePlacement(): Placement {
    return this.args.placement ?? 'bottom';
  }

  get offsetDistance(): number {
    return this.args.offset ?? 8;
  }

  get anchoring(): PopoverAnchoring {
    return this.args.anchoring ?? 'beside';
  }

  // ── Visual dials: each resolves ONLY its own arg + a fixed default.
  // No dial reads kind or anchoring, so the axes stay orthogonal — set
  // one and nothing else moves. (Want the old "edit looks blurred +
  // elevated" preset? Set @backdrop / @elevation explicitly.)

  get size(): PopoverSize {
    return this.args.size ?? 'compact';
  }

  get backdrop(): PopoverBackdrop {
    return this.args.backdrop ?? 'none';
  }

  get elevation(): PopoverElevation {
    return this.args.elevation ?? 'raised';
  }

  get keyboardModel(): PopoverKeyboardModel | undefined {
    return this.args.keyboardModel;
  }

  get isOverlay(): boolean {
    return this.anchoring === 'overlay';
  }

  get isCenter(): boolean {
    return this.anchoring === 'center';
  }

  /** A caret only makes sense for a 'beside' popover that floats off
   *  its anchor — not for an overlay (covers the source) or a centered
   *  modal (not anchored). */
  get hasArrow(): boolean {
    return Boolean(this.args.arrow) && this.anchoring === 'beside';
  }

  get hasDim(): boolean {
    return this.backdrop === 'dim';
  }

  /** Default autoFocus policy. */
  get shouldAutoFocus(): boolean {
    if (this.args.autoFocus !== undefined) return this.args.autoFocus;
    return this.args.kind !== 'details';
  }

  /** ARIA role for the popover root. details is a passive
   *  tooltip; every interactive kind is a dialog. Host can override
   *  via `@role` (e.g. 'menu' for an action list). */
  get role(): string {
    if (this.args.role) return this.args.role;
    return this.args.kind === 'details' ? 'tooltip' : 'dialog';
  }

  /** Trap focus + aria-modal. Driven by @trapFocus, not kind. */
  get shouldTrapFocus(): boolean {
    return this.args.trapFocus ?? false;
  }

  get isModal(): boolean {
    return this.shouldTrapFocus;
  }

  /** Delegate keyboard events into the popover body. Active when the
   *  host explicitly passes @keyboardModel — that signals there is an
   *  inner pick/edit target that owns key events. */
  get shouldDelegateKeyboard(): boolean {
    return this.args.keyboardModel !== undefined;
  }

  get layerTier(): SurfaceLayerTier {
    if (this.args.layerTier) return this.args.layerTier;
    // A dim dims the whole page — that's a modal affordance, so the
    // popover (and its dim) belong in the modal tier, above other
    // floating UI. Without this, an `beside` popover sits in the
    // 'popover' tier (z ~1000) while the dim defaults near 10000 and
    // would render ON TOP of its own popover, blurring it out.
    if (this.hasDim) return 'modal';
    if (this.anchoring === 'center') return 'modal';
    if (this.anchoring === 'overlay') return 'cell-lift';
    return 'popover';
  }

  /** Inline style string for the popover root. Carries the optional
   *  `relativeScale` arg as a `transform: scale(...)` with origin
   *  pinned to the popover's top-left corner.
   *
   *  WHY NOT CSS `zoom`: the CSS `zoom` property scales ALL element
   *  dimensions — INCLUDING positional `top` / `left` written by the
   *  anchored positioning modifier. So a popover with `top: 200px` and
   *  `zoom: 0.8` actually paints at `top: 160px`, jumping it away
   *  from its anchor.
   *
   *  WHY transform + top-left origin: the anchor modifier uses Floating UI's
   *  `computePosition` which already reads `getBoundingClientRect`
   *  (which RETURNS post-transform coords), so the scaled popover's
   *  apparent box is what the positioner sizes against. With
   *  `transform-origin: top left`, the visual top-left of the scaled
   *  box stays exactly at the `top: y; left: x;` point — for
   *  `bottom-start` placement that's the cell's bottom-left, which
   *  is what we want.
   *
   *  Center placement gets NO scale (center is a viewport modal, not
   *  an anchored surface; it always renders at viewport scale). */
  get rootStyle(): string {
    const z = this.args.relativeScale;
    if (z === undefined || z === 1) return '';
    // Only beside popovers honor relativeScale. Center is a viewport
    // modal — not anchored to scalable host content. Shadow already
    // overlays the source cell which is itself in host coords (the
    // shadowAnchor modifier reads cell's screen bbox, which already
    // reflects canvas zoom), so an extra scale would double-apply.
    if (this.anchoring !== 'beside') return '';
    // Hard safety clamp — a host that does its own math could send
    // something extreme. We don't want layout to explode either way.
    const clamped = Math.max(0.4, Math.min(2.5, z));
    return `transform: scale(${clamped}); transform-origin: top left;`;
  }

  // ─── classes ────────────────────────────────────────────────────

  /** Composite class for the popover root. Includes kind + placement
   *  + size + backdrop + elevation. CSS reads these as orthogonal
   *  modifiers (see styles below). */
  get popoverClass(): string {
    return [
      'bx-popover',
      `bx-popover--${this.args.kind}`,
      `bx-popover--placement-${this.anchoring}`,
      `bx-popover--size-${this.size}`,
      `bx-popover--backdrop-${this.backdrop}`,
      `bx-popover--elevation-${this.elevation}`,
    ].join(' ');
  }

  // ─── escalation glyph ──────────────────────────────────────────

  /** Other kinds the user can escalate to (filtered to exclude
   *  the current one). When empty, no escalation chrome renders. */
  get escalationTargets(): PopoverKind[] {
    return (this.args.canEscalateTo ?? []).filter((k) => k !== this.args.kind);
  }

  /** The single kind the corner glyph escalates to: the highest-priority
   *  available target (see POPOVER_ESCALATION_PRIORITY). One source of
   *  truth for the glyph, the label, and the click — they never disagree. */
  get primaryEscalationTarget(): PopoverKind | undefined {
    return resolvePopoverEscalationTarget(this.escalationTargets);
  }

  get hasEscalation(): boolean {
    return this.primaryEscalationTarget != null && this.args.onEscalate != null;
  }

  /** Glyph for the corner escalation button — the primary target's glyph
   *  (e.g. ✎ when edit is offered). Never a generic kebab while a real
   *  target exists, so the affordance reads as "lift to <that kind>". */
  get escalationGlyph(): string {
    const target = this.primaryEscalationTarget;
    return target ? this.kindGlyph(target) : '⋯';
  }

  /** Aria-label for the corner escalation button. */
  get escalationLabel(): string {
    const target = this.primaryEscalationTarget;
    return target
      ? `Switch to ${this.kindLabel(target)}`
      : 'Switch popover mode';
  }

  /** Click handler for the corner glyph — escalates to the same primary
   *  target the glyph depicts. */
  fireEscalateNext = (): void => {
    const target = this.primaryEscalationTarget;
    if (target) this.args.onEscalate?.(target);
  };

  kindLabel(kind: PopoverKind): string {
    return POPOVER_KIND_LABELS[kind];
  }

  kindGlyph(kind: PopoverKind): string {
    return POPOVER_KIND_GLYPHS[kind];
  }

  /** Dim click — fires onDismiss if provided. Bound here so the
   *  template can wire it without `(fn ...)` plumbing. */
  handleDimClick = (): void => {
    this.args.onDismiss?.();
  };

  // Modifiers exposed on instance for Glint strict mode.
  anchoredPopover = anchoredPopover;
  shadowAnchor = shadowAnchor;
  popoverFocus = popoverFocusModifier;
  trapPopoverFocus = trapPopoverFocusModifier;
  delegatePopoverKeyboard = delegatePopoverKeyboardModifier;
  dismissOnOutside = dismissOnOutside;
  allocatePopoverLayer = allocatePopoverLayer;
  popoverSurfaceRoot = popoverSurfaceRoot;
  bridgeThemeVars = bridgeThemeVariables;
  cleanupClosedPopover = cleanupClosedPopoverModifier;

  <template>
    <span
      hidden
      aria-hidden='true'
      {{this.cleanupClosedPopover @open this.instanceId}}
    ></span>
    {{#unless @open}}
      <span
        hidden
        aria-hidden='true'
        {{this.cleanupClosedPopover false this.instanceId}}
      ></span>
    {{/unless}}
    {{#if @open}}
      {{! Dim — full-viewport dim layer behind the popover, mounted
            as a sibling so it doesn't share the popover's z-stack. Only
            renders when backdrop === 'dim' (center modals).  }}
      {{#if this.hasDim}}
        {{#in-element this.portalTarget insertBefore=null}}
          {{! template-lint-disable-tree no-invalid-interactive }}
          <div
            class='bx-popover-dim'
            data-bx-popover-instance={{this.instanceId}}
            {{this.allocatePopoverLayer this.layerTier @zIndex}}
            {{this.bridgeThemeVars @anchor}}
            {{on 'click' this.handleDimClick}}
            aria-hidden='true'
          ></div>
        {{/in-element}}
      {{/if}}

      {{#if this.isOverlay}}
        {{#in-element this.portalTarget insertBefore=null}}
          <div
            class={{this.popoverClass}}
            data-bx-popover
            data-bx-popover-instance={{this.instanceId}}
            data-bx-popover-kind={{@kind}}
            role={{this.role}}
            aria-modal={{if this.isModal 'true'}}
            aria-label={{@label}}
            aria-labelledby={{@labelledby}}
            aria-describedby={{@describedby}}
            data-bx-popover-placement='overlay'
            data-bx-popover-anchor-selector={{@anchor}}
            data-bx-popover-keyboard-model={{this.keyboardModel}}
            data-bx-popover-keyboard-lock={{if
              this.shouldDelegateKeyboard
              'true'
              'false'
            }}
            data-bx-popover-focus-token={{@focusToken}}
            data-surface-preserve-focus
            style={{this.rootStyle}}
            {{this.allocatePopoverLayer this.layerTier @zIndex}}
            {{this.bridgeThemeVars @anchor}}
            {{this.popoverSurfaceRoot}}
            {{this.shadowAnchor @anchor}}
            {{this.dismissOnOutside @onDismiss}}
            {{this.popoverFocus @focusToken enabled=this.shouldAutoFocus}}
            {{this.trapPopoverFocus enabled=this.shouldTrapFocus}}
            {{this.delegatePopoverKeyboard enabled=this.shouldDelegateKeyboard}}
            ...attributes
          >
            {{#if this.hasEscalation}}
              <button
                type='button'
                class='bx-popover__escalate'
                aria-label={{this.escalationLabel}}
                title={{this.escalationLabel}}
                {{on 'click' this.fireEscalateNext}}
              >{{this.escalationGlyph}}</button>
            {{/if}}
            <div class='bx-popover__body'>
              {{! Per-kind named-block dispatch. yield-to only accepts a
                  static block name, so the kinds are enumerated here — once,
                  inside the component — and hosts just write the named
                  blocks details / edit / tools. }}
              {{#if (eq @kind 'edit')}}
                <div class='bx-popover__pane' data-bx-popover-pane='edit'>
                  {{yield to='edit'}}
                </div>
              {{else if (eq @kind 'tools')}}
                <div class='bx-popover__pane' data-bx-popover-pane='tools'>
                  {{yield to='tools'}}
                </div>
              {{else}}
                <div class='bx-popover__pane' data-bx-popover-pane='details'>
                  {{yield to='details'}}
                </div>
              {{/if}}
            </div>
          </div>
        {{/in-element}}
      {{else if this.isCenter}}
        {{#in-element this.portalTarget insertBefore=null}}
          <div
            class={{this.popoverClass}}
            data-bx-popover
            data-bx-popover-instance={{this.instanceId}}
            data-bx-popover-kind={{@kind}}
            role={{this.role}}
            aria-modal={{if this.isModal 'true'}}
            aria-label={{@label}}
            aria-labelledby={{@labelledby}}
            aria-describedby={{@describedby}}
            data-bx-popover-placement='center'
            data-bx-popover-anchor-selector={{@anchor}}
            data-bx-popover-keyboard-model={{this.keyboardModel}}
            data-bx-popover-keyboard-lock={{if
              this.shouldDelegateKeyboard
              'true'
              'false'
            }}
            data-bx-popover-focus-token={{@focusToken}}
            data-surface-preserve-focus
            style={{this.rootStyle}}
            {{this.allocatePopoverLayer this.layerTier @zIndex}}
            {{this.bridgeThemeVars @anchor}}
            {{this.popoverSurfaceRoot}}
            {{this.dismissOnOutside @onDismiss}}
            {{this.popoverFocus @focusToken enabled=this.shouldAutoFocus}}
            {{this.trapPopoverFocus enabled=this.shouldTrapFocus}}
            {{this.delegatePopoverKeyboard enabled=this.shouldDelegateKeyboard}}
            ...attributes
          >
            {{#if this.hasEscalation}}
              <button
                type='button'
                class='bx-popover__escalate'
                aria-label={{this.escalationLabel}}
                title={{this.escalationLabel}}
                {{on 'click' this.fireEscalateNext}}
              >{{this.escalationGlyph}}</button>
            {{/if}}
            <div class='bx-popover__body'>
              {{! Per-kind named-block dispatch. yield-to only accepts a
                  static block name, so the kinds are enumerated here — once,
                  inside the component — and hosts just write the named
                  blocks details / edit / tools. }}
              {{#if (eq @kind 'edit')}}
                <div class='bx-popover__pane' data-bx-popover-pane='edit'>
                  {{yield to='edit'}}
                </div>
              {{else if (eq @kind 'tools')}}
                <div class='bx-popover__pane' data-bx-popover-pane='tools'>
                  {{yield to='tools'}}
                </div>
              {{else}}
                <div class='bx-popover__pane' data-bx-popover-pane='details'>
                  {{yield to='details'}}
                </div>
              {{/if}}
            </div>
          </div>
        {{/in-element}}
      {{else}}
        {{#in-element this.portalTarget insertBefore=null}}
          <div
            class={{this.popoverClass}}
            data-bx-popover
            data-bx-popover-instance={{this.instanceId}}
            data-bx-popover-kind={{@kind}}
            role={{this.role}}
            aria-modal={{if this.isModal 'true'}}
            aria-label={{@label}}
            aria-labelledby={{@labelledby}}
            aria-describedby={{@describedby}}
            data-bx-popover-placement='beside'
            data-bx-popover-anchor-selector={{@anchor}}
            data-bx-popover-keyboard-model={{this.keyboardModel}}
            data-bx-popover-keyboard-lock={{if
              this.shouldDelegateKeyboard
              'true'
              'false'
            }}
            data-bx-popover-focus-token={{@focusToken}}
            data-surface-preserve-focus
            style={{this.rootStyle}}
            {{this.allocatePopoverLayer this.layerTier @zIndex}}
            {{this.bridgeThemeVars @anchor}}
            {{this.popoverSurfaceRoot}}
            {{this.anchoredPopover
              @anchor
              placement=this.effectivePlacement
              offsetOptions=this.offsetDistance
            }}
            {{this.dismissOnOutside @onDismiss}}
            {{this.popoverFocus @focusToken enabled=this.shouldAutoFocus}}
            {{this.trapPopoverFocus enabled=this.shouldTrapFocus}}
            {{this.delegatePopoverKeyboard enabled=this.shouldDelegateKeyboard}}
            ...attributes
          >
            {{#if this.hasArrow}}
              <div class='bx-popover__arrow' data-bx-popover-arrow></div>
            {{/if}}
            {{#if this.hasEscalation}}
              <button
                type='button'
                class='bx-popover__escalate'
                aria-label={{this.escalationLabel}}
                title={{this.escalationLabel}}
                {{on 'click' this.fireEscalateNext}}
              >{{this.escalationGlyph}}</button>
            {{/if}}
            <div class='bx-popover__body'>
              {{! Per-kind named-block dispatch. yield-to only accepts a
                  static block name, so the kinds are enumerated here — once,
                  inside the component — and hosts just write the named
                  blocks details / edit / tools. }}
              {{#if (eq @kind 'edit')}}
                <div class='bx-popover__pane' data-bx-popover-pane='edit'>
                  {{yield to='edit'}}
                </div>
              {{else if (eq @kind 'tools')}}
                <div class='bx-popover__pane' data-bx-popover-pane='tools'>
                  {{yield to='tools'}}
                </div>
              {{else}}
                <div class='bx-popover__pane' data-bx-popover-pane='details'>
                  {{yield to='details'}}
                </div>
              {{/if}}
            </div>
          </div>
        {{/in-element}}
      {{/if}}
    {{/if}}

    {{! template-lint-disable no-whitespace-for-layout }}
    <style scoped>
      /* ════════════════════════════════════════════════════════════
       * Popover visual system — driven by 5 orthogonal class modifiers:
       *   .bx-popover--{kind}        details | edit | tools
       *   .bx-popover--placement-{p} beside | shadow | center
       *   .bx-popover--size-{s}      compact | comfortable | spacious | auto
       *   .bx-popover--backdrop-{b}  none | tint | blur | dim
       *   .bx-popover--elevation-{e} flat | raised | elevated | floating
       *
       * Each axis paints ONE thing, so the cartesian product is
       * predictable. CSS custom properties let hosts re-skin
       * without overriding rules.
       * ════════════════════════════════════════════════════════════ */

      .bx-popover {
        position: absolute;
        /* Fallback sits in the host window (700, 900) — above the top bar,
         * below host popups/modals; the real value comes from --bx-popover-z
         * (see SurfaceLayerManager). */
        z-index: var(--bx-popover-z, 740);
        font: 13px/1.4
          var(
            --bx-popover-font-family,
            var(
              --font-sans,
              Inter,
              ui-sans-serif,
              system-ui,
              -apple-system,
              'Segoe UI',
              sans-serif
            )
          );
        color: var(--bx-popover-fg, var(--popover-foreground, #111827));
        /* Single source of truth for the surface fill. backdrop sets
         * this var (opaque / translucent), kind overrides the hue. */
        background: var(--bx-popover-bg, #fff);
        /* visible (not hidden) so the optional arrow can poke past the
         * edge. Corner-clipping moved to .bx-popover__body, which rounds
         * its own scroll container — same anti-notch effect, but without
         * trapping the arrow. */
        overflow: visible;
        animation: bx-popover-in 100ms cubic-bezier(0.32, 0.72, 0.4, 1);
      }
      @keyframes bx-popover-in {
        from {
          opacity: 0;
          transform: translateY(-2px) scale(0.985);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      /* ─── SIZE — width / height tokens ─────────────────────────
       * Defaults hug the content. Each tier's MAX-width is the
       * smallest box that fits its target use case cleanly; min-width
       * is just below that so picker rows don't shrink under their
       * content. Hosts override per-token via CSS custom properties.
       *
       *   compact     status pill picker, true/false picker (~6-8 word menus)
       *   comfortable date picker grid, chips picker, slider editor
       *   spacious    formula builder, color picker grid, year-12-grid
       */
      .bx-popover--size-compact {
        min-width: var(--bx-popover-size-compact-min-w, 176px);
        max-width: min(var(--bx-popover-size-compact-max-w, 240px), 92vw);
        max-height: min(
          var(--bx-popover-size-compact-max-h, 280px),
          75vh,
          var(--bx-popover-avail-h, 100vh)
        );
      }
      .bx-popover--size-comfortable {
        min-width: var(--bx-popover-size-comfortable-min-w, 240px);
        max-width: min(var(--bx-popover-size-comfortable-max-w, 320px), 92vw);
        max-height: min(
          var(--bx-popover-size-comfortable-max-h, 360px),
          75vh,
          var(--bx-popover-avail-h, 100vh)
        );
      }
      .bx-popover--size-spacious {
        min-width: var(--bx-popover-size-spacious-min-w, 320px);
        max-width: min(var(--bx-popover-size-spacious-max-w, 460px), 92vw);
        max-height: min(
          var(--bx-popover-size-spacious-max-h, 500px),
          80vh,
          var(--bx-popover-avail-h, 100vh)
        );
      }
      /* auto adds nothing — content drives. Used for shadow popovers
       * where the anchor's width is the floor (set by shadowAnchor). */

      /* ─── BACKDROP — surface material ─────────────────────────
       * Each value sets the surface fill (`--bx-popover-bg`); the base
       * rule paints it. The alpha is what makes them distinct:
       *   none   fully opaque        — flat solid card
       *   tint   ~80% opaque         — the page tints through
       *   blur   ~55% opaque + blur  — frosted glass (the bg MUST be
       *          translucent or the backdrop-filter shows nothing)
       *   dim  opaque + page dim   — the separate .bx-popover-dim
       *          element dims the page behind it */
      .bx-popover--backdrop-none {
        --bx-popover-bg: var(--popover, #fff);
      }
      .bx-popover--backdrop-tint {
        --bx-popover-bg: var(
          --bx-popover-bg-tint,
          color-mix(in srgb, var(--popover, #fff) 80%, transparent)
        );
      }
      .bx-popover--backdrop-blur {
        --bx-popover-bg: var(
          --bx-popover-bg-blur,
          color-mix(in srgb, var(--popover, #fff) 55%, transparent)
        );
        backdrop-filter: blur(12px) saturate(1.4);
        -webkit-backdrop-filter: blur(12px) saturate(1.4);
      }
      .bx-popover--backdrop-dim {
        --bx-popover-bg: var(--popover, #fff);
      }

      /* Dim — full-viewport dim layer mounted as a sibling.
       * Click dismisses (host wires onDismiss). Z-index sits ONE
       * BELOW the popover's z (so the popover renders on top). */
      .bx-popover-dim {
        position: fixed;
        inset: 0;
        background: var(
          --bx-popover-dim-bg,
          color-mix(in srgb, var(--foreground, #0f172a) 40%, transparent)
        );
        backdrop-filter: blur(2px);
        /* The dim allocates its own layer from the same (modal) tier,
         * and renders just before the popover, so it gets a lower z and
         * sits directly beneath it. (No `- 1` hack: the popover takes
         * the next number in the tier.) */
        z-index: var(--bx-popover-z, 800);
        animation: bx-popover-dim-in 140ms ease-out;
      }
      @keyframes bx-popover-dim-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      /* ─── ELEVATION — shadow + ring ladder ─────────────────────
       * Each tier ONE notch up:
       *   radius      4 → 6 → 8 → 12
       *   shadow      none → xs → md → xl
       *   border      none → subtle → subtle → subtle
       * Shadow depth increases with each tier so 'raised', 'elevated',
       * and 'floating' are visually distinct. */
      /* The whole ladder derives from ONE radius base so a theme moves
       * every tier consistently. Each value has two override scopes:
       *   --bx-popover-radius / --bx-popover-shadow-{tier}
       *       popover-only — no effect on any other UI
       *   --radius / --shadow-{sm,md,xl}
       *       the theme's global tokens */
      .bx-popover--elevation-flat {
        --bx-popover-border: transparent;
        border-radius: calc(var(--bx-popover-radius, var(--radius, 6px)) - 2px);
        box-shadow: none;
      }
      .bx-popover--elevation-raised {
        --bx-popover-border: var(--border, #e5e7eb);
        border-radius: var(--bx-popover-radius, var(--radius, 6px));
        box-shadow: var(
          --bx-popover-shadow-raised,
          var(
            --shadow-sm,
            0 1px 3px rgba(0, 0, 0, 0.08),
            0 1px 2px rgba(0, 0, 0, 0.06)
          )
        );
      }
      .bx-popover--elevation-elevated {
        --bx-popover-border: var(--border, #e5e7eb);
        border-radius: calc(var(--bx-popover-radius, var(--radius, 6px)) + 2px);
        box-shadow: var(
          --bx-popover-shadow-elevated,
          var(
            --shadow-md,
            0 4px 12px rgba(0, 0, 0, 0.1),
            0 2px 4px rgba(0, 0, 0, 0.07)
          )
        );
      }
      .bx-popover--elevation-floating {
        --bx-popover-border: var(--border, #e5e7eb);
        border-radius: calc(var(--bx-popover-radius, var(--radius, 6px)) * 2);
        box-shadow: var(
          --bx-popover-shadow-floating,
          var(
            --shadow-xl,
            0 12px 32px rgba(0, 0, 0, 0.14),
            0 4px 10px rgba(0, 0, 0, 0.09)
          )
        );
      }

      /* ─── PLACEMENT — POSITION ONLY ───────────────────────────
       * anchoring decides WHERE the popover sits, never how it looks
       * (that's the elevation axis). 'beside' is positioned by the
       * anchoredPopover JS modifier; 'overlay' overlays the source via
       * the shadowAnchor JS modifier and takes its radius/shadow from
       * elevation (defaults to `flat` → tight, cell-like corners);
       * 'center' centers itself in the viewport: */
      .bx-popover--placement-center {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        animation: bx-popover-center-in 180ms cubic-bezier(0.32, 0.72, 0.4, 1);
      }
      @keyframes bx-popover-center-in {
        from {
          opacity: 0;
          transform: translate(-50%, -48%) scale(0.96);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
      }

      /* ─── KIND — content-color hints ──────────────────────────
       * Tone-of-voice differentiation. Most chrome is now driven by
       * elevation + size; per-kind overrides only differentiate
       * what's left (tools is dark; details has muted body color). */
      .bx-popover--details {
        color: var(--bx-popover-fg-muted, var(--muted-foreground, #1f2937));
        font-size: 12px;
      }
      /* tools is an INVERTED surface — it defaults to the theme's
       * foreground/background swapped, so it stays "the dark one" in a
       * light theme and "the light one" in a dark theme. */
      .bx-popover--tools {
        --bx-popover-bg: var(--bx-popover-tools-bg, var(--foreground, #1f2937));
        color: var(--bx-popover-tools-fg, var(--background, #f9fafb));
      }
      /* edit's sticky-note yellow is a semantic "unsaved" signal, not a
       * brand color — it stays fixed by default; themes override it via
       * --bx-popover-edit-bg / --bx-popover-edit-border (the -resolved
       * vars exist so an outer override isn't shadowed by this rule). */
      .bx-popover--edit {
        --bx-popover-edit-bg-resolved: var(--bx-popover-edit-bg, #fef7d6);
        --bx-popover-edit-border-resolved: var(
          --bx-popover-edit-border,
          #f5d75e
        );
        --bx-popover-bg: var(--bx-popover-edit-bg-resolved);
      }
      .bx-popover--edit.bx-popover--backdrop-tint {
        --bx-popover-bg: color-mix(
          in srgb,
          var(--bx-popover-edit-bg-resolved) 80%,
          transparent
        );
      }
      .bx-popover--edit.bx-popover--backdrop-blur {
        --bx-popover-bg: color-mix(
          in srgb,
          var(--bx-popover-edit-bg-resolved) 55%,
          transparent
        );
      }
      .bx-popover--edit
        .bx-popover__pane
        > [data-surface-popover-target='edit'] {
        background: var(--bx-popover-edit-bg-resolved);
      }
      .bx-popover--edit
        .bx-popover__pane
        > [data-surface-popover-target='edit']
        > * {
        background-color: var(--bx-popover-edit-bg-resolved);
        box-shadow:
          inset 0 0 0 1px
            color-mix(
              in srgb,
              var(--bx-popover-edit-border-resolved) 56%,
              transparent
            ),
          0 16px 42px rgba(120, 85, 0, 0.12);
      }
      .bx-popover--tools[class*='bx-popover--elevation-'] {
        --bx-popover-border: color-mix(
          in srgb,
          var(--bx-popover-tools-fg, var(--background, #fff)) 12%,
          transparent
        );
      }

      /* ─── ESCALATION GLYPH — corner button ─────────────────────
       * Compact one-glyph escalation in the top-right. Only renders
       * when the contract has multiple popover kinds (the host's
       * canEscalateTo includes kinds OTHER than current). For
       * single-kind contracts, no chrome — the body is the popover. */
      .bx-popover__escalate {
        /* Small unobtrusive corner glyph. 18px, always visible at
         * 0.55 opacity (the popover is open, the affordance should be
         * discoverable without hovering), fills with soft accent on
         * hover. */
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
        width: 18px;
        height: 18px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--bx-popover-fg-muted, var(--muted-foreground, #9ca3af));
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition:
          background 80ms,
          color 80ms,
          opacity 80ms;
        opacity: 0.55;
      }
      .bx-popover__escalate:hover,
      .bx-popover__escalate:focus-visible {
        opacity: 1;
        background: color-mix(
          in srgb,
          var(--bx-popover-accent, var(--primary, #4f46e5)) 10%,
          transparent
        );
        color: var(--bx-popover-accent, var(--primary, #4f46e5));
      }
      .bx-popover--tools .bx-popover__escalate {
        color: color-mix(
          in srgb,
          var(--bx-popover-tools-fg, var(--background, #fff)) 60%,
          transparent
        );
      }
      .bx-popover--tools .bx-popover__escalate:hover {
        background: color-mix(
          in srgb,
          var(--bx-popover-tools-fg, var(--background, #fff)) 12%,
          transparent
        );
        color: var(--bx-popover-tools-fg, var(--background, #fff));
      }

      /* ─── BODY ──────────────────────────────────────────────────
       *
       * INTENTIONALLY NO PADDING. Each editor mounted inside the
       * popover body owns its own 6px gutter (the "picker convention").
       *
       * Why convention vs popover-pads-everything: the picker primitives
       * (PickOne / PickMany) ship as standalone widgets and may be
       * mounted in a Form, an inspector pane, or a custom shell.
       * If the popover OWNED the padding, the picker would have no
       * breathing room outside a popover. Convention keeps each editor
       * self-contained.
       *
       * If you're authoring a new editor pane, add padding: 6px to
       * the root and use gap for inner rhythm. That's it. */
      .bx-popover__body {
        display: block;
        max-height: inherit;
        overflow: auto;
        /* round the scroll container to match the surface so list /
         * picker content doesn't square off the popover's corners
         * (the root no longer clips — see its overflow note). */
        border-radius: inherit;
        /* Border lives here, not on the root, so it never intersects
         * the arrow which is positioned on the root element. */
        border: 1px solid var(--bx-popover-border, transparent);
      }

      /* ─── PANE — per-kind wrapper around the active named block ────
       * Class/data hook only: NO padding (the body's picker convention
       * applies — each editor pane owns its own 6px gutter). Target a
       * kind via .bx-popover__pane[data-bx-popover-pane='edit']. */
      .bx-popover__pane {
        display: block;
        border-radius: inherit;
      }

      /* ─── ARROW — optional caret (beside anchoring) ───────────────
       * A rotated square that inherits the surface fill (so it matches
       * any kind/backdrop automatically) and pokes out toward the
       * anchor. The JS modifier sets its left/top + the static side. */
      .bx-popover__arrow {
        position: absolute;
        width: 0;
        height: 0;
        pointer-events: none;
        /* Shape, direction, and fill are set as inline styles by the
         * anchoredPopover modifier using the CSS border-triangle technique. */
      }
    </style>
  </template>
}
