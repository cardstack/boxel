import { modifier } from 'ember-modifier';

interface Signature {
  Element: HTMLElement;
  Args: {
    Positional: [];
    Named: {
      // The offset to restore when the element mounts. Only the element's
      // first install restores it: recording writes the live offset back into
      // the tracked state this arg is derived from, which re-runs the
      // modifier, and a re-install must not restart the restore (or re-hide
      // the list) under the user's own scrolling.
      scrollTop?: number;
      // Reports the live offset once the user starts scrolling. Absent =>
      // persistence is off (the element neither restores nor records), so a
      // shared consumer can opt out by simply not passing it.
      onChange?: (scrollTop: number) => void;
    };
  };
}

// Restore a scroll offset when the element mounts, then record the user's own
// scrolling — built for content that lays out asynchronously.
//
// The naive "set scrollTop once on mount" fails here for two reasons, both
// visible on the operator-mode search sheet: (1) the results rows render a
// frame or more after mount (and prerendered rows hydrate later still), so at
// mount the list isn't tall enough to accept the offset — the assignment clamps
// to the top; and (2) the sheet's height animates open, so the scroll
// container's own height (and thus its max scroll offset) keeps changing for
// the duration of the transition. A fixed rAF countdown races both and
// intermittently gives up at the top (the "flash to top, sometimes stay there"
// bug).
//
// Instead, re-apply the target whenever anything that could change the geometry
// happens — content mutations (rows added / hydrated) via a MutationObserver,
// and box-size changes (the open transition, a card resizing) via a
// ResizeObserver — for as long as we're still restoring. The first genuine user
// scroll gesture flips the element from restoring to recording: re-applies
// stop, and from then on the live offset is reported through `onChange`.
//
// Because only a user gesture flips that switch, the restore's own programmatic
// writes and any layout-induced scroll resets can never be mistaken for a user
// scroll and overwrite the saved offset.
//
// While a non-zero offset hasn't stuck yet, the element carries
// `data-scroll-restore-pending` so consumers can hide it (opacity) instead of
// painting the clamped-to-top intermediate states — the list reveals already
// in place rather than visibly jumping mid-restore. The tag comes off when an
// applied offset survives read-back *and* the element's own box has stopped
// changing: while the sheet's open transition is still growing the container,
// a tiny viewport lets almost any offset "stick" trivially, and revealing on
// that early stick paints the later clamp-and-snap as the box outgrows
// still-hydrating content. The tag also comes off when the user gestures, or —
// if the saved offset is unreachable because the list is now shorter — after
// a cap, revealing at the clamped position rather than hiding forever.
const RESTORE_PENDING_ATTRIBUTE = 'data-scroll-restore-pending';
const RESTORE_REVEAL_CAP_MS = 1000;
// A box-change gap this long means the container's size transition is over
// (during one it changes every frame, ~8-16ms apart).
const BOX_QUIET_MS = 100;

// Elements that already got their mount-time restore. Recording feeds the live
// offset back into the tracked state the `scrollTop` arg reads, so every
// recorded scroll re-runs the modifier on the same element; only the first
// install may restore (and hide) — a re-install is recording-only.
let restoredElements = new WeakSet<Element>();

export default modifier<Signature>(
  (element, _positional, { scrollTop, onChange }) => {
    if (!onChange) {
      return undefined;
    }
    let firstInstall = !restoredElements.has(element);
    restoredElements.add(element);
    // A re-install never restores: target 0 disables the re-apply machinery
    // and the reveal tag below. `restoring` still starts true so that, as on
    // first install, only a genuine gesture opens recording — a layout-induced
    // scroll reset right after a re-install must not be recorded either.
    let target = firstInstall ? (scrollTop ?? 0) : 0;
    let restoring = true;
    let ticking = false;
    let framesLeft = 0;
    let rafId: number | undefined;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let revealed = target <= 0;
    let lastBoxChangeAt = performance.now();

    let reveal = () => {
      revealed = true;
      element.removeAttribute(RESTORE_PENDING_ATTRIBUTE);
      if (revealTimer !== undefined) {
        clearTimeout(revealTimer);
        revealTimer = undefined;
      }
    };
    let applyTarget = () => {
      element.scrollTop = target;
      if (revealed) {
        return;
      }
      // Read-back says whether the assignment stuck or clamped (the content
      // isn't tall enough yet). A stick only counts once the box is quiet —
      // mid-transition the viewport is small enough that any offset sticks —
      // so until then keep ticking and re-checking.
      if (Math.abs(element.scrollTop - target) <= 1) {
        if (performance.now() - lastBoxChangeAt >= BOX_QUIET_MS) {
          reveal();
        } else {
          framesLeft = Math.max(framesLeft, 1);
        }
      }
    };

    let tick = () => {
      ticking = false;
      if (!restoring) {
        return;
      }
      if (target > 0) {
        applyTarget();
      }
      if (framesLeft > 0) {
        framesLeft -= 1;
        schedule();
      }
    };
    let schedule = () => {
      if (!restoring || ticking) {
        return;
      }
      ticking = true;
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- restore needs post-layout scroll height
      rafId = requestAnimationFrame(tick);
    };
    // Any geometry change (or the initial mount) starts a short re-apply burst.
    // A single post-change apply can land before the browser has finished
    // laying the new size out (clamping to the top); re-applying for a few
    // frames rides out that settling. Overlapping changes keep re-arming the
    // burst, so a list that grows in stages stays pinned the whole way.
    let bump = () => {
      if (!restoring) {
        return;
      }
      framesLeft = 5;
      schedule();
    };

    let mutationObserver: MutationObserver | undefined;
    let resizeObserver: ResizeObserver | undefined;
    if (firstInstall) {
      // Tag before first paint (so not even one clamped frame shows), apply
      // once synchronously, then re-apply post-layout and on every geometry
      // change until the user takes over.
      if (target > 0) {
        element.setAttribute(RESTORE_PENDING_ATTRIBUTE, '');
        revealTimer = setTimeout(reveal, RESTORE_REVEAL_CAP_MS);
        applyTarget();
      }
      bump();

      // Content changes — rows added, and the class/style swaps that
      // prerendered rows go through as they hydrate — bump the burst.
      // `attributes: true` matters: hydration often changes a tile's height
      // without adding nodes.
      mutationObserver = new MutationObserver(bump);
      mutationObserver.observe(element, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
      // The container's own box changes bump too — chiefly the sheet's open
      // transition, which grows this element's height (and shrinks its max
      // scroll offset) frame by frame while `restore` is running. Each one also
      // stamps the quiet clock the reveal's stick-check gates on.
      resizeObserver = new ResizeObserver(() => {
        lastBoxChangeAt = performance.now();
        bump();
      });
      resizeObserver.observe(element);
    }

    let stopRestoring = () => {
      if (!restoring) {
        return;
      }
      // The user has taken over: stop re-applying and tear the observers down so
      // later content/layout churn (e.g. a background refetch) can't yank the
      // list around. From here `record` reports the user's own scrolling.
      restoring = false;
      // Even if the saved offset never stuck, the user is interacting now —
      // the element must be visible.
      reveal();
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
        rafId = undefined;
      }
    };
    let record = () => {
      if (!restoring) {
        onChange(element.scrollTop);
      }
    };
    // The ways a user actually drives this scroll container. A programmatic
    // scrollTop assignment or a layout reset fires `scroll` but none of these,
    // so it can't end the restore or be recorded as a user position.
    let gestureEvents = ['wheel', 'touchmove', 'pointerdown', 'keydown'];
    for (let name of gestureEvents) {
      element.addEventListener(name, stopRestoring, { passive: true });
    }
    element.addEventListener('scroll', record, { passive: true });

    return () => {
      reveal();
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
      }
      for (let name of gestureEvents) {
        element.removeEventListener(name, stopRestoring);
      }
      element.removeEventListener('scroll', record);
    };
  },
);
