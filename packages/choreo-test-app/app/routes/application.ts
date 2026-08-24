import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';
import { animateView } from 'glimmer-motion';
import { factor, setCrossing } from 'test-app/lib/tempo';

/**
 * Gallery card ⇄ demo page, as one shared-element transition.
 *
 * The browser does the animating: this only says which things are which.
 * Magic Move, in Keynote's terms, is three kinds of thing —
 *
 *   MOVES   the same object in both scenes, paired with `.add(old, new)` so it
 *           becomes one layer that travels. Both renderings are stretched to
 *           fill that one box and crossed 0% to 100% inside it, because glyphs
 *           cannot morph into other glyphs and a stage cannot morph into a
 *           bigger stage — but one box can hold both while it grows.
 *   LEAVES  only in the old scene. It fades first, to make room.
 *   ARRIVES only in the new scene. It fades in once the move is nearly home.
 *
 * The scroll is part of it rather than something that happens before or after.
 * The update runs inside the snapshot: the route swaps, the window is put where
 * the new page wants it, and only then is the second snapshot taken. Every
 * arrival goes to the top — opening a demo, and stepping from one demo to the
 * next, which can be asked for from the foot of the page. Going back is the
 * exception: the gallery returns to the pixel it was left at.
 *
 * The real page is veiled for the duration (see `body` in the stylesheet): a
 * transition captures a snapshot of whatever is on screen, and the pieces
 * that actually move are named and paired separately below — the rest of the
 * page underneath them is better off blank than a frozen photograph of
 * itself. VEIL_OUT_MS is why the veil has to land before the snapshot does.
 */
const BASE = 0.9;
/* Emphasised, not snappy. [0.22, 1, 0.36, 1] leaves almost instantly and then
   coasts, which reads as a jump followed by a settle; a Magic Move wants to
   gather itself, travel, and arrive. */
const EASE = [0.2, 0, 0, 1] as const;
const DEMO_ROUTE = 'demo';

/**
 * How long the real page is veiled before a transition, and how long it takes
 * to return after.
 *
 * Fixed, not proportional to the morph — there used to be a noise texture
 * here too, and a fade proportional to the transition's own speed was how it
 * avoided ever looking out of place at any tempo. The texture is gone; a
 * plain opacity veil does not have that problem, so a fixed duration reads
 * the same at any tempo without the arithmetic.
 */
const VEIL_OUT_MS = 20;
const VEIL_IN_MS = 180;

/** recomputed per transition, so the tempo control in the top bar applies */
function times(morph: number) {
  return {
    /**
     * The page's own furniture. It overlaps the departure deliberately: the
     * arriving scene starts before the leaving one has finished, so the screen
     * is covered the whole way.
     *
     * Left with a gap between them — out by a third, in after two thirds —
     * there is a stretch in the middle where NOTHING is on screen, and the
     * whole page goes black behind the moving pieces. In slow-mo it is
     * unmistakable; at speed it reads as a flash.
     */
    arrive: { delay: morph * 0.18, duration: morph * 0.55, ease: EASE },
    leave: { duration: morph * 0.42, ease: EASE },
    /** the code and the pager, which really can wait for the move to land */
    arriveLate: { delay: morph * 0.66, duration: morph * 0.4, ease: EASE },
    move: { duration: morph, ease: EASE },
    /** the arriving image is solid before the leaving one has gone, so the
     *  pair covers its box the whole way and never dips toward the page */
    fadeIn: { duration: morph * 0.34, ease: 'easeOut' } as const,
    fadeOut: { duration: morph * 0.62, ease: 'easeIn' } as const,
  };
}

type Times = ReturnType<typeof times>;

function demoIdOf(info: Transition['to']): string | undefined {
  return (info?.params as Record<string, string> | undefined)?.['demo_id'];
}

export default class ApplicationRoute extends Route {
  @service declare router: RouterService;
  private wrapping = false;
  /**
   * Where the gallery was standing, so the back button can put it back.
   * Null until the gallery has actually been left: a demo loaded standalone
   * has no position to restore, and pretending "0" was one sends the stage
   * flying toward a card thousands of pixels below the fold.
   */
  private galleryScroll: number | null = null;

  constructor(owner: Owner) {
    super(owner);
    this.router.on('routeWillChange', this.wrap);
    registerDestructor(this, () => {
      this.router.off('routeWillChange', this.wrap);
    });
  }

  wrap = (transition: Transition) => {
    if (this.wrapping || transition.isAborted || !transition.from) {
      return;
    }
    const leaving = transition.from.name;
    const arriving = transition.to?.name;
    const opening = arriving === DEMO_ROUTE && leaving !== DEMO_ROUTE;
    const closing = leaving === DEMO_ROUTE && arriving !== DEMO_ROUTE;
    const id = opening ? demoIdOf(transition.to) : demoIdOf(transition.from);

    if (opening) {
      this.galleryScroll = window.scrollY;
    }

    /**
     * Where the arriving page wants the window — applied AFTER the new page
     * has rendered, so the value is clamped against the right height.
     *
     * Going back to the gallery is the only case with somewhere to return to.
     * Everything else starts at the top — including demo to demo, which can be
     * asked for from the pager at the very BOTTOM of the page: keeping the
     * scroll there lands you at the foot of a demo you have not seen yet.
     *
     * The standalone case is the subtle one. A demo opened by URL has no
     * saved gallery position, and "top of the gallery" is wrong twice over:
     * the card this page pairs with sits far below the fold, so the flight
     * aims off-screen and the landing reads as a jump. With nothing to
     * restore, the gallery is scrolled so THAT CARD is in view — the stage
     * flies to something the eye can follow.
     */
    const settle = () => {
      if (!closing) {
        window.scrollTo(0, 0);
        return;
      }
      if (this.galleryScroll !== null) {
        window.scrollTo(0, this.galleryScroll);
        return;
      }
      const card = id
        ? document.querySelector<HTMLElement>(`.card[data-demo='${id}']`)
        : null;
      if (card) {
        const box = card.getBoundingClientRect();
        const centred =
          window.scrollY + box.top - (window.innerHeight - box.height) / 2;
        window.scrollTo(0, Math.max(0, centred));
      } else {
        window.scrollTo(0, 0);
      }
    };

    const morph = BASE * factor();
    // Instant means instant: no snapshot, no layers, no one-frame animation
    // pretending to be none. The route simply changes — but it still changes
    // to the top of the new page, after the render, when the new page's height
    // is what the scroll is clamped against.
    if (morph === 0) {
      requestAnimationFrame(settle);
      return;
    }
    const t = times(morph);

    transition.abort();
    this.wrapping = true;
    setCrossing(true);
    const root = document.documentElement;
    root.classList.remove('is-returning');
    root.classList.add('is-crossing');
    // the floor for any layer Motion is not given keyframes for (see the
    // ::view-transition-* rule in the stylesheet)
    root.style.setProperty('--gm-morph', `${morph}s`);
    root.style.setProperty('--gm-veil-out', `${VEIL_OUT_MS}ms`);
    root.style.setProperty('--gm-veil-in', `${VEIL_IN_MS}ms`);

    // The card at the OTHER end of this transition — the one the stage flies
    // FROM on the way in, or TO on the way back — is not itself a named,
    // paired subject: it CONTAINS four (see `pair()` below), and naming a
    // container of already-named things is the nesting violation that froze
    // the page outright (see the comment on `pair()`). But left alone, its
    // own background and border are ordinary live DOM, never extracted into
    // the transition, so they sit there in the grid for the ENTIRE flight —
    // which is the "black box already in the right place" bug: the shell
    // arrives before anything it is supposed to be holding does.
    //
    // Fixed the same way the grain and the real page are: not named, just
    // toggled. `is-veiled` drops this one card's own background and border to
    // nothing, instantly, in the same frame the flight starts — no CSS
    // transition on it in either direction, because the moment it is REMOVED
    // is the exact frame the browser hands the real DOM back, and a card
    // whose shell fades back a beat after its contents have already snapped
    // into place would be its own small seam. Empty space where the card
    // would be, for exactly as long as its contents are elsewhere.
    const cardEl = id
      ? document.querySelector<HTMLElement>(`.card[data-demo='${id}']`)
      : null;
    cardEl?.classList.add('is-veiled');

    const resume = quietTheRest();

    // The real page is veiled BEFORE the transition starts, so the snapshot a
    // moment later captures a blank root rather than a photograph of whatever
    // was on screen. The delay has to match VEIL_OUT_MS, or the snapshot lands
    // mid-fade and captures a half-veiled page.
    setTimeout(() => {
      let resumeArrivals: (() => void) | undefined;

      const view = animateView(async () => {
        await transition.retry();
        resumeArrivals = quietTheRest();
        settle();
      });

      view
        .layout(t.move)
        .old({ opacity: [1, 0] }, t.leave)
        .new({ opacity: [0, 1] }, t.arrive);

      if (id && (opening || closing)) {
        pair(view, id, opening, t);
      }

      // NOT unveiled from `done()` below. `done()` fires off `whenEnded`'s own
      // poll of getAnimations() — and by its own admission (see whenEnded's
      // doc comment) that poll can find the board empty and call done a whole
      // morph early, mid-retarget, before Motion has replaced the animations
      // it is watching for. That is a rounding error for a grain fade nobody
      // is staring at; it is the whole bug for a card whose entire job is to
      // stay invisible until its contents visibly land. `t.move.duration` is
      // not a guess — it IS the box's own tween — so the card is unveiled on
      // that clock, not on a poll that has already been caught jumping the
      // gun once in this file.
      if (cardEl) {
        setTimeout(() => cardEl.classList.remove('is-veiled'), morph * 1000);
      }

      const done = () => {
        this.wrapping = false;
        setCrossing(false);
        resume();
        resumeArrivals?.();
        root.classList.add('is-returning');
        root.classList.remove('is-crossing');
        cardEl?.classList.remove('is-veiled');
      };
      void Promise.resolve(view).then(() => whenEnded(morph, done), done);
    }, VEIL_OUT_MS);
  };
}

/**
 * Stop the page animating while the browser animates the page.
 *
 * A view transition composites a dozen snapshot layers every frame. This
 * gallery is twenty-six live demos, most of them looping forever, and they go
 * on running underneath it — competing for exactly the frames the transition
 * needs. The result is not a dropped frame here and there but erratic pacing:
 * measured frame to frame, the morph moves 6 units, then 1, then 8, then 2,
 * instead of arcing smoothly. That is the jitter.
 *
 * So everything the document is animating is paused for the duration and
 * resumed afterwards — except the transition's own pseudo-elements, which are
 * the whole point. Pausing is not stopping: a looping demo resumes exactly
 * where it was, which is why this is safe to do to work you did not write.
 */
function quietTheRest(): () => void {
  const paused = document
    .getAnimations()
    .filter(
      (animation) =>
        animation.playState === 'running' &&
        !String(
          (animation.effect as KeyframeEffect | null)?.pseudoElement ?? ''
        ).startsWith('::view-transition')
    );
  for (const animation of paused) {
    animation.pause();
  }
  return () => {
    for (const animation of paused) {
      try {
        animation.play();
      } catch {
        // an animation whose element left with the old page: nothing to resume
      }
    }
  };
}

/**
 * Wait for the view transition's own animations, polled rather than awaited.
 *
 * Motion retimes a transition by replacing its animations, so the set you can
 * collect when it becomes ready is not the set that finishes it — await those
 * and the veil lifts while the morph is still moving.
 */
function whenEnded(morph: number, done: () => void) {
  const started = performance.now();
  const running = () =>
    document.documentElement
      .getAnimations({ subtree: true })
      .some((animation) =>
        String(
          (animation.effect as KeyframeEffect | null)?.pseudoElement ?? ''
        ).startsWith('::view-transition')
      );
  // Polled slowly and deliberately. getAnimations() walks the document, and
  // doing that every 80ms while the compositor is animating a dozen layers
  // costs frames — visible as single-frame dropouts in the middle of the
  // morph. Nothing here needs to know quickly; it only lifts the veil.
  const look = () => {
    if (!running() || performance.now() - started > morph * 1000 + 800) {
      done();
      return;
    }
    setTimeout(look, 250);
  };
  setTimeout(look, Math.max(250, morph * 1000 * 0.6));
}

/**
 * KNOWN BUG, not yet root-caused: the return trip FROM the Shared Layout demo
 * (`tabs`) — All examples or the brand mark, back to the gallery — hard-freezes
 * the page. DOM and layout stay entirely correct underneath (confirmed via
 * `elementFromPoint`/computed rects mid-freeze) but nothing paints; only a hard
 * reload recovers. Reproduces every time on that one demo; Playhead's own
 * return trip, tested back to back with it, is clean. Not caused by pairing
 * `.card-meta` (tried, reverted, froze either way — see the comment where the
 * type pairs are declared below). Best lead so far: `SharedTabs` runs its own
 * `layoutId` FLIP animation (the moving tab-pill) on the SAME frame this page
 * transition is trying to capture and pair a layout move for — worth checking
 * whether the two layout engines are fighting over the same element.
 */
function pair(
  view: ReturnType<typeof animateView>,
  id: string,
  opening: boolean,
  t: Times
) {
  const card = `.card[data-demo='${id}']`;
  const head = `.demo-head[data-demo='${id}']`;
  /** old end first, new end second — and the other way round on the way back */
  const ends = (inGallery: string, inPage: string): [string, string] =>
    opening ? [inGallery, inPage] : [inPage, inGallery];

  const moves: [string, string, string][] = [
    // the frame: tile-sized to full width
    [...ends(`${card} .card-stage`, '.stage-wrap'), 'gm-move gm-stage'],
    // The demo is NOT a layer of its own.
    //
    // `.ex` fills its stage exactly — 1178x518 against the stage's 1180x520 —
    // so pairing it as well gave the compositor a second big texture on top of
    // an identical one, four large scaling blits a frame instead of two. That
    // is the difference between a transition that holds 60fps and one that
    // presents every other frame, which is what the stalls in a screen capture
    // turned out to be. Unnamed, it simply rides inside the stage's snapshot.
    //
    // A .card-meta ⇄ .demo-meta pairing was tried here, on the theory that
    // the card is TWO boxes (stage, then meta) and the page should offer back
    // the same two. It is disabled: the View Transitions API does not allow a
    // named element to have independently-named descendants without their own
    // nested-group setup, and .card-meta's children (title/lede/group, right
    // below) are already named. Pairing the container too froze the ENTIRE
    // page — not a visual glitch, an unrecoverable one, only a hard reload
    // got out of it. If the outer box is worth pairing, it has to happen
    // WITHOUT also naming what is inside it, which the three lines below do
    // not currently allow for.
    // the type: the same three lines, set twice
    [...ends(`${card} .card-title`, `${head} h1`), 'gm-move gm-type'],
    [...ends(`${card} .card-lede`, `${head} .lede`), 'gm-move gm-type'],
    [...ends(`${card} .card-group`, `${head} .kicker`), 'gm-move gm-type'],
  ];

  // crop(false) throughout: Motion's crop is object-fit: cover, which clips
  // whatever changes aspect. The locked box in the stylesheet stretches instead
  for (const [from, to, layer] of moves) {
    view
      .add(from, to)
      .class(layer)
      .crop(false)
      .group(false)
      .layout(t.move)
      .new({ opacity: [0, 1] }, t.fadeIn)
      .old({ opacity: [1, 0] }, t.fadeOut);
  }

  // the chrome is the same on both pages: one layer that holds still, rather
  // than two snapshots of the same thing dissolving into each other. The api
  // pills go in here too — on a demo-to-demo move they are usually the same
  // words in the same place, and a row of pills that dissolves into an almost
  // identical row of pills is the definition of a pointless animation.
  for (const steady of ['.topbar', '.footer']) {
    view
      .add(steady)
      .class('gm-move gm-steady')
      .crop(false)
      .group(false)
      .layout(t.move)
      .new({ opacity: [1, 1] }, t.fadeIn)
      .old({ opacity: [1, 0] }, t.fadeIn);
  }

  // The pills are steady only between two DEMOS, where they are the same words
  // in the same place. Coming from the gallery there are none to be steady
  // against, and holding the new ones at full opacity put them on screen,
  // finished, while everything else was still travelling. So they cross like
  // anything else: identical content crossfading is invisible, and arriving
  // content fades in instead of appearing.
  view
    .add('.apis')
    .class('gm-move gm-steady')
    .crop(false)
    .group(false)
    .layout(t.move)
    .new({ opacity: [0, 1] }, t.arrive)
    .old({ opacity: [1, 0] }, t.leave);

  // Everything else is the ROOT, and that is the whole point.
  //
  // An element snapshot captures the element at its full size. The gallery
  // grid is twenty-six cards tall, so naming it hands the compositor a texture
  // several screens high and asks it to fade that every frame — measured off a
  // screen recording, the transition was being presented at a fraction of
  // 60fps, one frame's worth of movement followed by three or four repeats.
  //
  // The root snapshot is clipped to the VIEWPORT. One texture, screen-sized,
  // for the whole page — and it needs no names, no classes and no bookkeeping.
  // Asking for it here is also what hands Motion the timing for it.
}
