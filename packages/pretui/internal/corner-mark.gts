// Pretui — corner marks: the placement and hue Badge and Indicator share.
//
// A corner mark sits on the edge of another control — a count on an inbox
// icon, a presence dot on an avatar. Both components wrap their child in an
// inline box and position the mark against one of its four logical corners,
// so RTL moves the mark with the reading direction.
import { htmlSafe } from '@ember/template';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint cannot see
// it here (accepted parse baseline, same as toaster.gts / focus.gts)
import { modifier } from 'ember-modifier';
import type { SafeString } from '@ember/template';
import { PRETUI_TONES, resolveTone } from '../pretui-primitives';
import type { PretuiTone, PretuiToneArg } from '../pretui-primitives';

export type CornerPlacement = 'top-end' | 'top-start' | 'bottom-end' | 'bottom-start';

const PLACEMENTS: readonly CornerPlacement[] = ['top-end', 'top-start', 'bottom-end', 'bottom-start'];

// The MUI anchorOrigin and Mantine position spellings are physical.
const PLACEMENT_ALIASES: Record<string, CornerPlacement> = {
  'top-right': 'top-end',
  'top-left': 'top-start',
  'bottom-right': 'bottom-end',
  'bottom-left': 'bottom-start',
};

export function resolveCorner(value: string | undefined): CornerPlacement {
  let canonical = value ? (PLACEMENT_ALIASES[value] ?? value) : 'top-end';
  return (PLACEMENTS as readonly string[]).includes(canonical) ? (canonical as CornerPlacement) : 'top-end';
}

/** A tone's hue as a CSS value — one map for every component that paints a tone as a single colour. */
export const TONE_HUES: Record<PretuiTone, string> = {
  neutral: 'var(--muted-foreground)',
  primary: 'var(--primary)',
  info: 'var(--pretui-info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--destructive)',
  attention: 'var(--pretui-attention)',
};

export function resolveCornerTone(tone: PretuiToneArg | string | undefined, fallback: PretuiTone): PretuiTone {
  return resolveTone(tone, PRETUI_TONES, fallback);
}

/** The mark's hue as one custom property; the stylesheet derives the rest. */
export function cornerHueStyle(tone: PretuiTone): SafeString {
  return htmlSafe(`--pretui-mark-hue: ${TONE_HUES[tone]}`);
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * Points the first focusable element inside the mark's wrapper at the
 * spoken run with `aria-describedby`, so focusing the control reads its own
 * name and then the mark's meaning ("Messages, button, 3 unread"). Without
 * it the run is a sibling a screen reader only reaches by reading on. The
 * control's existing descriptions are kept; only this id is added and
 * removed.
 */
export const describesFocusable = modifier((root: HTMLElement, [id]: [string | undefined]) => {
  if (!id) {
    return;
  }
  let target = root.querySelector<HTMLElement>(FOCUSABLE);
  if (!target) {
    return;
  }
  let before = target.getAttribute('aria-describedby');
  let ids = (before ?? '').split(/\s+/).filter(Boolean);
  if (!ids.includes(id)) {
    target.setAttribute('aria-describedby', [...ids, id].join(' '));
  }
  return () => {
    let now = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((t) => t && t !== id);
    if (now.length) {
      target.setAttribute('aria-describedby', now.join(' '));
    } else {
      target.removeAttribute('aria-describedby');
    }
  };
});
