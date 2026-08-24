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
 * the new page wants it, and only then is the second snapshot taken. Opening
 * goes to the top; going back returns to the pixel the gallery was left at.
 *
 * The grain steps aside for the duration (see `html::before`): a noise field is
 * the one thing on the page a compositor cannot carry.
 */
const BASE = 0.72;
/* Emphasised, not snappy. [0.22, 1, 0.36, 1] leaves almost instantly and then
   coasts, which reads as a jump followed by a settle; a Magic Move wants to
   gather itself, travel, and arrive. */
const EASE = [0.2, 0, 0, 1] as const;
const DEMO_ROUTE = 'demo';

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
  /** where the gallery was standing, so the back button can put it back */
  private galleryScroll = 0;

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

    const morph = BASE * factor();
    // Instant means instant: no snapshot, no layers, no one-frame animation
    // pretending to be none. The route simply changes.
    if (morph === 0) {
      return;
    }
    const t = times(morph);
    const scrollTo = opening
      ? 0
      : closing
        ? this.galleryScroll
        : window.scrollY;

    transition.abort();
    this.wrapping = true;
    setCrossing(true);
    const root = document.documentElement;
    root.classList.remove('is-returning');
    root.classList.add('is-crossing');
    // the floor for any layer Motion is not given keyframes for (see the
    // ::view-transition-* rule in the stylesheet)
    root.style.setProperty('--gm-morph', `${morph}s`);
    // and the grain's own fade, in proportion — a fixed number of milliseconds
    // is a fifth of a normal transition and a fiftieth of a slow one
    root.style.setProperty('--gm-grain-out', `${morph * 0.22}s`);
    root.style.setProperty('--gm-grain-in', `${morph * 0.4}s`);

    const resume = quietTheRest();

    const view = animateView(async () => {
      await transition.retry();
      window.scrollTo(0, scrollTo);
      // Scrolled HERE, inside the snapshot, and not before it.
      //
      //
      // Doing it before the transition instead makes it an instantaneous jump
      // the eye sees on its own — measured frame by frame, one 10.5-unit spike
      // followed by three near-still frames while the route renders, and only
      // then the morph. That reads as the hesitation at the start.
      //
      // Inside the snapshot it costs nothing visually: the page is not being
      // painted, and the paired elements are positioned from where they REALLY
      // are on each side.
    });

    // the implicit `root` subject: the page itself, crossfading, at viewport
    // size — everything not paired below is carried by this one layer
    view.layout(t.move);

    if (id && (opening || closing)) {
      pair(view, id, opening, t);
    }

    const done = () => {
      this.wrapping = false;
      setCrossing(false);
      resume();
      root.classList.add('is-returning');
      root.classList.remove('is-crossing');
    };
    void Promise.resolve(view).then(() => whenEnded(morph, done), done);
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
 * and the grain returns while the morph is still moving.
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
  // morph. Nothing here needs to know quickly; it only puts the grain back.
  const look = () => {
    if (!running() || performance.now() - started > morph * 1000 + 800) {
      done();
      return;
    }
    setTimeout(look, 250);
  };
  setTimeout(look, Math.max(250, morph * 1000 * 0.6));
}

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
