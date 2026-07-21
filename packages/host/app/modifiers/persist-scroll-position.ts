import { modifier } from 'ember-modifier';

interface Signature {
  Element: HTMLElement;
  Args: {
    Positional: [];
    Named: {
      // The offset to restore when the element mounts. Read once on setup;
      // later changes to the arg don't re-trigger a restore.
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
export default modifier<Signature>(
  (element, _positional, { scrollTop, onChange }) => {
    if (!onChange) {
      return undefined;
    }
    let target = scrollTop ?? 0;
    let restoring = true;
    let ticking = false;
    let framesLeft = 0;
    let rafId: number | undefined;

    let tick = () => {
      ticking = false;
      if (!restoring) {
        return;
      }
      if (target > 0) {
        element.scrollTop = target;
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

    // Apply once synchronously (covers content already laid out at mount, so
    // there's no flash), then re-apply post-layout and on every geometry change
    // until the user takes over.
    if (target > 0) {
      element.scrollTop = target;
    }
    bump();

    // Content changes — rows added, and the class/style swaps that prerendered
    // rows go through as they hydrate — bump the burst. `attributes: true`
    // matters: hydration often changes a tile's height without adding nodes.
    let mutationObserver = new MutationObserver(bump);
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    // The container's own box changes bump too — chiefly the sheet's open
    // transition, which grows this element's height (and shrinks its max scroll
    // offset) frame by frame while `restore` is running.
    let resizeObserver = new ResizeObserver(bump);
    resizeObserver.observe(element);

    let stopRestoring = () => {
      if (!restoring) {
        return;
      }
      // The user has taken over: stop re-applying and tear the observers down so
      // later content/layout churn (e.g. a background refetch) can't yank the
      // list around. From here `record` reports the user's own scrolling.
      restoring = false;
      mutationObserver.disconnect();
      resizeObserver.disconnect();
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
      mutationObserver.disconnect();
      resizeObserver.disconnect();
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
