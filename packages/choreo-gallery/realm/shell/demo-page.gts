import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { MotionConfig } from 'glimmer-motion';

import type { GalleryDemo, Near } from '../demo';
import { FilmLink } from '../lib/film-link';
import { passFocus, takesFocus } from '../lib/focus';
import { labSlug, LabState } from '../lib/lab';
import { MotionHold } from '../lib/motion-hold';
import { type Theater, theaterView } from '../lib/theater';
import { ChoreoMark } from './choreo-mark';
import { CodeBox } from './code-box';
import { DemoLink } from './demo-link';
import { DemoStage } from './demo-stage';
import { GuideLink } from './guide-link';
import { HeldStage } from './held-stage';
import { LabPanel } from './lab-panel';
import { LabToggle } from './lab-toggle';
import { MotionToggle } from './motion-toggle';
import { SpeedPicker, startPage } from './speed-picker';

interface Signature {
  Args: {
    demo: GalleryDemo;
    /** the demos either side of this one in its gallery's order */
    near?: Near;
    /** opens a demo card through the host; without it there is no pager */
    onOpen?: (demo: GalleryDemo) => void;
    theater: Theater;
  };
}

/**
 * One demo, at full size: what it is, the live stage, how to write it, and —
 * for the demos that bring one — how it works.
 */
export class DemoPage extends Component<Signature> {
  /** the stage's film, when it has one, for the notes' join triggers */
  readonly filmLink = new FilmLink();
  readonly lab = new LabState();
  /** for a viewer who asked for reduced motion, the stage waits to be asked */
  readonly hold = new MotionHold();

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args);
    startPage();
  }

  get labSlug(): string | undefined {
    return labSlug(this.args.demo);
  }

  get labOpen(): boolean {
    return this.lab.isOpen(this.labSlug);
  }

  toggleLab = () => this.lab.toggle(this.labSlug);

  /**
   * A replay, or a change of motion policy, mounts the stage afresh: a
   * `{{motion}}` node settles its reduced-motion policy as it mounts.
   */
  get take(): string {
    return `${this.lab.replays}:${this.hold.reducedMotion}`;
  }

  get Notes() {
    return (this.args.demo.constructor as typeof GalleryDemo).notes;
  }

  get well() {
    return (this.args.demo.constructor as typeof GalleryDemo).well;
  }

  /** only a demo with a film in its stage has a theater to enter */
  get inTheater(): boolean {
    return this.args.demo.theater === true && this.args.theater.on;
  }

  /** the way out goes with theater; the door back in takes focus */
  leaveTheater = () => {
    passFocus('theater-enter');
    this.args.theater.enter(false);
  };

  /**
   * Escape in theater leaves theater, as it leaves a full-screen video, and
   * goes no further: the host would otherwise take it as Escape for the card.
   */
  escapeTheater = modifier((element: HTMLElement) => {
    let keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && this.inTheater) {
        event.preventDefault();
        event.stopPropagation();
        this.leaveTheater();
      }
    };
    element.addEventListener('keydown', keydown);
    return () => element.removeEventListener('keydown', keydown);
  });

  /** whether there is a neighbour for the pager to open */
  get paged(): boolean {
    return Boolean(this.args.near?.prev || this.args.near?.next);
  }

  /**
   * the notes' join triggers, while the stage's film frame is attached; a
   * join plays only once the viewer has opened that film
   */
  get preview() {
    return this.filmLink.live ? this.filmLink.preview : undefined;
  }

  <template>
    {{#let @demo.slug as |slug|}}
      {{! THE BODY IS A WRAPPER THAT USUALLY IS NOT THERE: `display:
        contents` generates no box, so the page lays out as if it were absent
        — and in theater it becomes a flex column, which lets the stage be
        re-ORDERED to the front without being re-PARENTED. Moving an iframe in
        the DOM reloads it, and a film that restarts when you ask to see it
        bigger is not a film you can watch. }}
      <div
        class='demo-body {{if this.inTheater "is-theater"}}'
        data-test-demo-body
        data-test-theater={{this.inTheater}}
        {{this.escapeTheater}}
      >
        <article class='demo-head' data-demo={{slug}}>
          {{#if @onOpen}}
            {{#if @near.next}}
              {{! the pager is at the foot of the page, past the code — a long
                way to scroll to say "next". The same link, where you are
                already looking. }}
              <div class='demo-nav'>
                <DemoLink
                  @demo={{@near.next}}
                  @onOpen={{@onOpen}}
                  class='back next-demo'
                >
                  Next
                  <b>{{@near.next.title}}</b>
                  <span aria-hidden='true'>→</span>
                </DemoLink>
              </div>
            {{/if}}
          {{/if}}
          <div class='demo-meta'>
            <p class='kicker'>
              {{@demo.group}}
              {{#if this.Notes}}
                <span class='kicker-badge'>Deep Dive</span>
              {{/if}}
            </p>
            <h1>{{@demo.title}}</h1>
            <p class='lede'>{{@demo.lede}}</p>
          </div>
          <div class='apis'>
            {{#each @demo.apis as |api|}}
              <code class='api'>{{api}}</code>
            {{/each}}
          </div>
        </article>
        {{#if @demo.slowmo}}
          <SpeedPicker />
        {{/if}}
        <p class='demo-links'>
          <MotionToggle @hold={{this.hold}} />
          {{#if this.labSlug}}
            <LabToggle @open={{this.labOpen}} @onToggle={{this.toggleLab}} />
          {{/if}}
          <GuideLink @demo={{@demo}} />
        </p>
        <div
          class='stage-row {{if this.labOpen "with-lab"}}'
          data-test-stage-row
          {{theaterView}}
        >
          <HeldStage
            class='stage-wrap'
            @hold={{this.hold}}
            data-demo-stage
            data-test-stage
            data-well={{this.well}}
            {{@theater.stage}}
          >
            {{#each (array this.take) key='@identity'}}
              <MotionConfig @reducedMotion={{this.hold.reducedMotion}}>
                <DemoStage
                  @demo={{@demo}}
                  @face='stage'
                  @filmLink={{this.filmLink}}
                  @theater={{@theater}}
                />
              </MotionConfig>
            {{/each}}
            {{! THE MARK, in theater only, where the site's bar has stepped out.
            It is also the way out, because the thing a viewer wants after
            the film is how it was made — so the whole pill is the button,
            and on a narrow stage, where the words step out, the mark alone
            is still a target and the words are still its name. }}
            {{#if this.inTheater}}
              <button
                type='button'
                class='theater-mark'
                data-test-theater-exit
                {{on 'click' this.leaveTheater}}
                {{takesFocus 'theater-exit'}}
              >
                <ChoreoMark />
                <span class='theater-built'>How this is built</span>
              </button>
            {{/if}}
          </HeldStage>
          {{#if this.labOpen}}
            {{#if this.labSlug}}
              <LabPanel
                @slug={{this.labSlug}}
                @title={{@demo.title}}
                @onReplay={{this.lab.replay}}
              />
            {{/if}}
          {{/if}}
        </div>
        <CodeBox @source={{@demo.sample}} />
        {{! ...and, for a demo whose subject is its DATA, the data }}
        {{#if @demo.walkthrough.length}}
          <section class='walk' aria-label='Walkthrough'>
            {{#each @demo.walkthrough as |step|}}
              <p class='walk-note'>{{step.note}}</p>
              <CodeBox @label={{step.label}} @source={{step.source}} />
            {{/each}}
          </section>
        {{/if}}
        {{! How to use it, then how it works — in that order, because nobody
        needs the second one to get started }}
        {{#if this.Notes}}
          <this.Notes @preview={{this.preview}} />
        {{/if}}
        {{#if @onOpen}}
          {{#if this.paged}}
            <nav class='pager' aria-label='More demos'>
              {{#if @near.prev}}
                <DemoLink @demo={{@near.prev}} @onOpen={{@onOpen}}>
                  <span aria-hidden='true'>←</span>
                  <span class='sr-only'>Previous:</span>
                  {{@near.prev.title}}
                </DemoLink>
              {{else}}
                <span></span>
              {{/if}}
              {{#if @near.next}}
                <DemoLink @demo={{@near.next}} @onOpen={{@onOpen}}>
                  <span class='sr-only'>Next:</span>
                  {{@near.next.title}}
                  <span aria-hidden='true'>→</span>
                </DemoLink>
              {{/if}}
            </nav>
          {{/if}}
        {{/if}}
      </div>
    {{/let}}
    <style scoped>
      .demo-head {
        display: flex;
        flex-direction: column;
        gap: 18px;
        margin-bottom: 28px;
      }

      .demo-meta {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      /* "next" on a line of its own above the title */
      .demo-nav {
        display: flex;
        align-items: baseline;
        justify-content: flex-end;
        gap: 16px;
        padding-top: 10px;
      }

      .back {
        width: fit-content;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted-foreground);
        text-decoration: underline;
        text-decoration-color: var(--border-strong);
        text-underline-offset: 3px;
      }

      @media (hover: hover) {
        .back:hover {
          color: var(--foreground);
        }
      }

      .next-demo {
        display: inline-flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }

      .next-demo b {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 400;
        letter-spacing: 0.08em;
        color: var(--foreground);
      }

      @media (hover: hover) {
        .next-demo:hover b {
          color: var(--copper-ink);
        }
      }

      .kicker {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin: 0;
        font-family: var(--boxel-eyebrow-font-family);
        font-weight: var(--boxel-eyebrow-font-weight);
        font-size: var(--boxel-eyebrow-font-size);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        text-transform: uppercase;
        color: var(--primary-ink);
      }

      .kicker::before {
        content: '';
        width: 18px;
        height: 1px;
        background: var(--primary);
        box-shadow: 0 0 12px var(--glow);
      }

      .kicker-badge {
        display: inline-block;
        margin-left: 6px;
        padding: 2px 8px;
        font-size: 10px;
        font-family: var(--font-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--primary-ink);
        border: 1px solid
          color-mix(in srgb, var(--primary-ink) 55%, transparent);
        border-radius: 3px;
        vertical-align: middle;
      }

      h1 {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: clamp(2.4rem, 6vw, 4.2rem);
        letter-spacing: -0.045em;
        line-height: 0.92;
      }

      .lede {
        max-width: 38rem;
        margin: 0;
        color: var(--muted-foreground);
        font-size: 1.125rem;
      }

      .apis {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .api {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--iris-ink);
        background: color-mix(in srgb, var(--iris) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--iris) 30%, transparent);
        border-radius: 6px;
        padding: 3px 7px;
      }

      .demo-links {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 12px 24px;
        margin: 0 0 16px;
      }

      .stage-row {
        position: relative;
      }

      /* the lab sits beside the stage, and under it where the page is too
         narrow for both */
      .stage-row.with-lab {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: 16px;
      }

      @media (max-width: 760px) {
        .stage-row.with-lab {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      .stage-wrap {
        position: relative;
        /* the demo page's platter, so a stage's platter-scoped container
           queries answer here too — inline-size, because this box's height
           depends on what the stage needs */
        container-name: platter;
        container-type: inline-size;
        min-height: min(72vh, 680px);
        border: 1px solid var(--border);
        border-radius: 22px;
        /* clip, not hidden: a hidden box is still a scroll container, and
           would scroll to reveal a focused control a demo's transform has
           carried past the edge */
        overflow: clip;
        background:
          radial-gradient(
            70% 60% at 50% 40%,
            color-mix(in srgb, var(--primary) 10%, transparent),
            transparent 60%
          ),
          var(--canvas);
      }

      /* A FILM IS A WIDE FRAME. Towers is composed for a picture about
         sixteen by nine — the tower left of centre with its base on the
         ground, the type owning the right third — and the default well is a
         letterbox that crops the stone off the bottom. So its well takes the
         film's own aspect, capped so it never outgrows the screen. */
      .stage-wrap[data-well='wide'] {
        aspect-ratio: 16 / 9;
        min-height: 0;
        max-height: min(88vh, 1040px);
      }

      /* THE BASILICA IS TALL, and its film is composed for that: the towers
         run to the top of the frame and the rail sits under them, so its
         well is a shade taller than sixteen by nine, with a higher ceiling */
      .stage-wrap[data-well='tall'] {
        aspect-ratio: 16 / 10.5;
        min-height: 0;
        max-height: min(92vh, 1180px);
      }

      /* A LAPTOP IS A WIDE, SHORT SUBJECT ON A TALL PLATTER. A machine seen
         from a low three-quarter angle wants headroom above the lid and floor
         under the base — without it the framing solver keeps pulling the
         camera back to fit the height, and the drawing on the screen goes too
         small to read. */
      .stage-wrap[data-well='laptop'] {
        min-height: min(84vh, 860px);
      }

      /* ...and on a narrow screen a device's well takes the shape of the
         device. The flat laptop is 1178x838 scaled to fit, so on a phone it
         is width-bound, and a tall well then holds a very small machine with
         a band of empty air above and below it. The phone is the opposite
         shape: a landscape well holds a very small phone with air either
         side, and a tall one lets the device fill the frame. */
      @media (max-width: 760px) {
        .stage-wrap[data-well='laptop'] {
          min-height: 0;
          aspect-ratio: 1178 / 838;
        }

        .stage-wrap[data-well='phone'] {
          min-height: 0;
          aspect-ratio: 5 / 7;
        }
      }

      /* ── Theater ────────────────────────────────────────────────────
         The film's page with the stage re-ordered to the front. Everything
         else keeps its order and sits below, which makes the mode a scroll
         rather than a destination. */
      .demo-body {
        display: contents;
      }

      .demo-body.is-theater {
        display: flex;
        flex-direction: column;
      }

      /* EDGE TO EDGE: out of the page's gutter to the full width of the
         site, which `theaterView` publishes as --site-w */
      .demo-body.is-theater .stage-row {
        order: -1;
        container-type: inline-size;
        margin-inline: calc((100% - var(--site-w, 100%)) / 2);
      }

      /* THE WELL'S ASPECT IS FOR A WELL. In theater the frame is as tall as
         what the viewer can see of the card — the element that scrolls it,
         published as --view-h, which in the host sits under the host's chrome
         and the card's header — capped at a square so a portrait phone does
         not turn the film into a tall strip. A document that scrolls itself
         falls back to the window, where dvh follows the visible viewport as a
         phone's browser chrome opens and closes. The window caps it either
         way: the scroller is the nearest ancestor set to scroll, and one that
         grows with its content would publish the whole page's height. The
         picture reframes to this box. */
      .demo-body.is-theater .stage-wrap {
        height: min(100vh, 100cqi);
        height: min(var(--view-h, 100dvh), 100dvh, 100cqi);
        min-height: 0;
        max-height: none;
        aspect-ratio: auto;
        border: 0;
        border-radius: 0;
      }

      /* the film ends at the fold and this is the first thing under it */
      .demo-body.is-theater .demo-nav {
        padding-top: 42px;
      }

      /* LEGIBLE ON A FILM, not on a page. These pictures run from a chalk
         noon to a night, so neither the gallery's ink nor its paper can be
         relied on for contrast: the mark gets its own ground, a dark blurred
         pill that belongs to no theme and works over any frame. */
      .theater-mark {
        position: absolute;
        top: clamp(12px, 2vw, 22px);
        right: clamp(14px, 2.2vw, 26px);
        z-index: 7;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 7px 13px 7px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(14, 12, 10, 0.55);
        /* the pill is dark in either theme, so the mark wears its dark
           colors on it, and the type and its button's ring are light: the
           one color that clears 3:1 on the pill over any frame from black
           to white */
        --mark-tail: var(--mark-tail-dark);
        --mark-orbit: var(--mark-orbit-dark);
        --pill-ink: rgba(255, 250, 242, 0.96);
        --ring: var(--pill-ink);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        font: inherit;
        cursor: pointer;
        opacity: 0.9;
        transition:
          opacity 200ms ease,
          background 200ms ease;
      }

      .theater-mark:hover {
        opacity: 1;
        background: rgba(14, 12, 10, 0.72);
      }

      .theater-mark :deep(svg) {
        display: block;
        width: 22px;
        height: 22px;
      }

      .theater-built {
        color: var(--pill-ink);
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .theater-mark:hover .theater-built {
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      /* ── The deep dive ──────────────────────────────────────────────
         A demo's notes, under the usage example: set smaller than the page
         on purpose, because nobody needs how the machine works to get
         started. The notes are their own components, so these reach in. */
      .demo-body :deep(.dive) {
        display: flex;
        flex-direction: column;
        gap: 34px;
        margin-top: 40px;
        padding-top: 30px;
        border-top: 1px solid var(--border);
        font-size: 15px;
        line-height: 1.72;
      }

      .demo-body :deep(.dive-head) {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 62ch;
      }

      .demo-body :deep(.dive-kicker) {
        margin: 0;
        font-family: var(--boxel-eyebrow-font-family);
        font-weight: var(--boxel-eyebrow-font-weight);
        font-size: calc(var(--boxel-eyebrow-font-size) * 10 / 11);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        text-transform: uppercase;
        color: var(--primary-ink);
      }

      .demo-body :deep(.dive-head h2) {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(22px, 3.4vw, 30px);
        font-weight: 700;
        line-height: 1.14;
        letter-spacing: -0.01em;
        text-wrap: balance;
        color: var(--ink-soft);
      }

      .demo-body :deep(.dive-lede) {
        margin: 0;
        font-size: 15px;
        line-height: 1.65;
        color: var(--muted-foreground);
      }

      .demo-body :deep(.dd) {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      /* the eyebrow names the function the section explains */
      .demo-body :deep(.dd-fn) {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin: 0;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.06em;
        color: var(--primary-ink);
      }

      .demo-body :deep(.dd-fn::after) {
        flex: 1;
        height: 1px;
        background: var(--border);
        content: '';
      }

      .demo-body :deep(.dd-fn span) {
        color: var(--subtle-foreground);
      }

      .demo-body :deep(.dd h3) {
        max-width: 30ch;
        margin: 0;
        font-family: var(--font-display);
        font-size: 19px;
        font-weight: 700;
        line-height: 1.22;
        text-wrap: balance;
        color: var(--ink-soft);
      }

      /* prose keeps a reading measure */
      .demo-body :deep(.dd-col) {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 68ch;
      }

      .demo-body :deep(.dd-col p) {
        margin: 0;
        color: var(--muted-foreground);
      }

      .demo-body :deep(.dd-col strong) {
        font-weight: 600;
        color: var(--ink-soft);
      }

      .demo-body :deep(.dd-col em) {
        font-style: normal;
        color: var(--copper-ink);
      }

      .demo-body :deep(.dd code) {
        font-family: var(--font-mono);
        font-size: 0.86em;
        color: var(--copper-ink);
      }

      /* a code box inside a note is the same object as the one above the
         dive; only its spacing changes, because the column owns the gaps */
      .demo-body :deep(.dd .sample) {
        margin-top: 0;
      }

      /* The notes' diagrams: a shared vocabulary of plates, boxes, rules and
         labels, drawn in each note's inline SVG and styled once here. */
      .demo-body :deep(.dd-fig) {
        margin: 2px 0 0;
        padding: 16px 16px 13px;
        border: 1px solid var(--border);
        border-radius: 16px;
        /* a light tint, capped at 4%: a dark tint over an already dark page
           does not read as a surface of its own */
        background: color-mix(in srgb, var(--surface-tint) 4%, transparent);
        /* a wide drawing scrolls inside its own box rather than the page */
        overflow-x: auto;
      }

      .demo-body :deep(.dd-fig figcaption) {
        max-width: 76ch;
        margin-top: 13px;
        padding-top: 11px;
        border-top: 1px solid var(--border);
        font-family: var(--font-mono);
        font-size: 11px;
        line-height: 1.6;
        color: var(--subtle-foreground);
      }

      .demo-body :deep(.dd-fig figcaption b) {
        font-weight: 500;
        color: var(--muted-foreground);
      }

      /* Capped, so a drawing stays subordinate to the prose it explains. At full
         page width a 900-unit viewBox renders its 11px labels larger than the 14px
         body text, which makes the diagram read as the main event. */
      .demo-body :deep(.dg) {
        display: block;
        width: 100%;
        /* below this the labels collide; the figure scrolls instead of squashing */
        min-width: 560px;
        max-width: 760px;
        height: auto;
        margin: 0 auto;
      }

      .demo-body :deep(.dg-plate) {
        fill: var(--canvas);
        stroke: var(--border);
      }

      .demo-body :deep(.dg-box) {
        fill: var(--card);
        stroke: var(--border-strong);
      }

      .demo-body :deep(.dg-boxcop) {
        fill: var(--card);
        stroke: var(--copper);
      }

      .demo-body :deep(.dg-hot) {
        fill: color-mix(in srgb, var(--primary) 16%, transparent);
        stroke: var(--primary-ink);
      }

      .demo-body :deep(.dg-band) {
        fill: color-mix(in srgb, var(--foreground) 4%, transparent);
      }

      .demo-body :deep(.dg-rule) {
        fill: none;
        stroke: var(--border-strong);
      }

      .demo-body :deep(.dg-hair) {
        fill: none;
        stroke: var(--border);
      }

      .demo-body :deep(.dg-cop) {
        fill: none;
        stroke: var(--copper);
      }

      .demo-body :deep(.dg-emberline) {
        fill: none;
        stroke: var(--primary-ink);
      }

      .demo-body :deep(.dg-hotline) {
        fill: none;
        stroke: var(--ember-hot);
        stroke-width: 2;
      }

      .demo-body :deep(.dg-inkline) {
        fill: none;
        stroke: var(--foreground);
        stroke-width: 1.6;
      }

      .demo-body :deep(.dg-dash) {
        stroke-dasharray: 3 3;
      }

      .demo-body :deep(.dg-dot) {
        fill: var(--ember-hot);
      }

      .demo-body :deep(.dg-copdot) {
        fill: var(--copper);
      }

      .demo-body :deep(.dg-faintdot) {
        fill: var(--subtle-foreground);
      }

      .demo-body :deep(.dg-arrow) {
        fill: var(--subtle-foreground);
      }

      .demo-body :deep(.dg-hand) {
        fill: var(--foreground);
        stroke: var(--canvas);
        stroke-width: 0.8;
      }

      .demo-body :deep(.dg-t) {
        font-family: var(--font-mono);
        font-size: 11px;
        fill: var(--foreground);
      }

      /* a hot label most often sits in a .dg-hot box */
      .demo-body :deep(.dg-t.is-hot) {
        fill: var(--hot-ink);
      }

      .demo-body :deep(.dg-t.is-dim) {
        fill: var(--muted-foreground);
      }

      .demo-body :deep(.dg-t.is-faint) {
        fill: var(--subtle-foreground);
      }

      .demo-body :deep(.dg-t.is-cop) {
        fill: var(--copper-ink);
      }

      .demo-body :deep(.dg-eb) {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 1.4px;
        fill: var(--subtle-foreground);
      }

      .demo-body :deep(.dg-h) {
        font-family: var(--font-display);
        font-size: 15px;
        font-weight: 700;
        fill: var(--foreground);
      }

      .demo-body :deep(.dg-h.is-hot) {
        fill: var(--hot-ink);
      }

      .walk {
        margin-top: 26px;
      }

      .walk-note {
        max-width: 68ch;
        margin: 26px 0 10px;
        color: var(--muted-foreground);
        font-size: 14px;
        line-height: 1.6;
      }

      .walk-note:first-child {
        margin-top: 0;
      }

      .pager {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        margin-top: 22px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }

      .pager > :deep(a) {
        text-decoration: underline;
        text-decoration-color: var(--border-strong);
        text-underline-offset: 3px;
        min-width: 0;
        max-width: 48%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media (hover: hover) {
        .pager > :deep(a:hover) {
          color: var(--foreground);
        }
      }

      /* a phone-sized stage has no room for a byline beside the mark: the
         words leave the picture but stay the button's name. The stage is the
         platter, so this answers to the card's width, which in a host stack
         is narrower than the window. */
      @container platter (max-width: 700px) {
        .theater-mark {
          padding: 7px 10px;
        }

        .theater-built {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
        }
      }

      @media (max-width: 720px) {
        /* a text link is a 17px-tall tap target; the padding is the target */
        .demo-nav {
          margin-bottom: -8px;
        }

        .back {
          padding: 8px 0;
        }

        .next-demo {
          gap: 6px;
        }

        .next-demo b {
          max-width: 42vw;
        }

        .pager > :deep(a) {
          max-width: 46%;
          padding: 8px 0;
        }

        .stage-wrap {
          min-height: min(74vh, 620px);
          border-radius: 16px;
        }
      }
    </style>
  </template>
}
