import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { motion } from 'glimmer-motion';

import type { GalleryDemo } from '../demo';
import type { GalleryNavigation } from '../lib/navigation';
import type { Theater } from '../lib/theater';
import { ChoreoMark } from './choreo-mark';
import { CodeBox } from './code-box';
import { DemoStage } from './demo-stage';
import { GalleryLink } from './gallery-link';
import { SpeedPicker } from './speed-picker';

interface Signature {
  Args: {
    demo: GalleryDemo;
    /** set inside the gallery; a demo card opened on its own has neither */
    nav?: GalleryNavigation;
    near?: { next?: GalleryDemo; prev?: GalleryDemo };
    theater: Theater;
  };
}

/**
 * One demo, at full size: what it is, the live stage, how to write it, and —
 * for the demos that bring one — how it works.
 */
export class DemoPage extends Component<Signature> {
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

  leaveTheater = () => this.args.theater.enter(false);

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
      >
        <article class='demo-head' data-demo={{slug}}>
          {{#if @nav}}
            {{! the pager is at the foot of the page, past the code — a long way
            to scroll to say "next". The same link, where you are already
            looking. }}
            <div class='demo-nav' {{motion role='furniture'}}>
              <GalleryLink
                @href={{@nav.hrefFor null}}
                @onFollow={{fn @nav.go null}}
                class='back back-all'
                data-gallery-home
              >
                <span class='back-arrow' aria-hidden='true'>←</span>
                All examples
              </GalleryLink>
              {{#if @near.next}}
                <GalleryLink
                  @href={{@nav.hrefFor @near.next.slug}}
                  @onFollow={{fn @nav.go @near.next.slug}}
                  class='back next-demo'
                >
                  Next
                  <b>{{@near.next.title}}</b>
                  →
                </GalleryLink>
              {{/if}}
            </div>
          {{/if}}
          {{! the same ids the gallery tile's pieces carry: the crossing pairs
          them and each pair is one flight — the stage, and the same three
          lines of type, set twice }}
          <div class='demo-meta'>
            <p class='kicker' {{motion id=(concat 'group-' slug) role='type'}}>
              {{@demo.group}}
              {{#if this.Notes}}
                <span class='kicker-badge'>Deep Dive</span>
              {{/if}}
            </p>
            <h1 {{motion id=(concat 'title-' slug) role='type'}}>
              {{@demo.title}}
            </h1>
            <p class='lede' {{motion id=(concat 'lede-' slug) role='type'}}>
              {{@demo.lede}}
            </p>
          </div>
          {{! one id on every demo page: between two demos the pills pair and the
          crossfade of identical content is invisible }}
          <div class='apis' {{motion id='apis' role='chrome'}}>
            {{#each @demo.apis as |api|}}
              <code class='api'>{{api}}</code>
            {{/each}}
          </div>
        </article>
        {{#if @demo.slowmo}}
          <SpeedPicker @slug={{slug}} />
        {{/if}}
        <div class='stage-row' data-test-stage-row>
          <div
            class='stage-wrap'
            data-demo-stage
            data-test-stage
            data-well={{this.well}}
            {{motion id=(concat 'stage-' slug) role='stage'}}
          >
            <DemoStage @demo={{@demo}} @face='stage' @theater={{@theater}} />
            {{! THE MARK, in theater only, where the site's bar has stepped out.
            It is also the way out, because the thing a viewer wants after
            the film is how it was made. }}
            {{#if this.inTheater}}
              <div class='theater-mark'>
                <ChoreoMark />
                <button
                  type='button'
                  class='theater-built'
                  data-test-theater-exit
                  {{on 'click' this.leaveTheater}}
                >How this is built</button>
              </div>
            {{/if}}
          </div>
        </div>
        {{! role='late': the code can wait for the move to land — the crossing
        fades it in after the flight, and only if a viewport can see it }}
        <CodeBox @source={{@demo.sample}} {{motion role='late'}} />
        {{! ...and, for a demo whose subject is its DATA, the data }}
        {{#if @demo.walkthrough.length}}
          <section class='walk' aria-label='Walkthrough' {{motion role='late'}}>
            {{#each @demo.walkthrough as |step|}}
              <p class='walk-note'>{{step.note}}</p>
              <CodeBox @label={{step.label}} @source={{step.source}} />
            {{/each}}
          </section>
        {{/if}}
        {{! How to use it, then how it works — in that order, because nobody
        needs the second one to get started }}
        {{#if this.Notes}}
          <this.Notes />
        {{/if}}
        {{#if @nav}}
          <nav class='pager' {{motion role='late'}}>
            {{#if @near.prev}}
              <GalleryLink
                @href={{@nav.hrefFor @near.prev.slug}}
                @onFollow={{fn @nav.go @near.prev.slug}}
              >
                ←
                {{@near.prev.title}}
              </GalleryLink>
            {{else}}
              <span></span>
            {{/if}}
            {{#if @near.next}}
              <GalleryLink
                @href={{@nav.hrefFor @near.next.slug}}
                @onFollow={{fn @nav.go @near.next.slug}}
              >
                {{@near.next.title}}
                →
              </GalleryLink>
            {{/if}}
          </nav>
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

      /* the transparent counterpart to the tile's metadata chin: the return
         trip has a second box to tween into, the same shape the gallery
         already has */
      .demo-meta {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      /* "all examples" and "next" on one line above the title */
      .demo-nav {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
        padding-top: 10px;
      }

      .back {
        width: fit-content;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      @media (hover: hover) {
        .back:hover {
          color: var(--ink);
        }
      }

      /* the canonical way back — brighter than a plain nav label, and the
         arrow nudges further left on hover */
      .back-all {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--ink);
      }

      @media (hover: hover) {
        .back-all:hover {
          color: var(--copper-ink);
        }

        .back-all:hover .back-arrow {
          transform: translateX(-3px);
        }
      }

      .back-arrow {
        display: inline-block;
        transition: transform 0.18s var(--ease);
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
        color: var(--ink);
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
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        /* ember-hot: it is a paired subject of the crossing, and lands on
           the tile's group line, which is ember-hot too */
        color: var(--ember-hot);
      }

      /* no draw-in here: this kicker already crossfades over from the tile
         on the timeline's clock, and a second animation would read as
         arriving twice */
      .kicker::before {
        content: '';
        width: 18px;
        height: 1px;
        background: var(--ember);
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
        color: var(--ember);
        border: 1px solid var(--ember);
        border-radius: 3px;
        opacity: 0.7;
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
        color: var(--ink-dim);
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
        color: var(--iris);
        background: rgba(150, 103, 247, 0.1);
        border: 1px solid rgba(150, 103, 247, 0.3);
        border-radius: 6px;
        padding: 3px 7px;
      }

      .stage-row {
        position: relative;
      }

      .stage-wrap {
        position: relative;
        /* the demo page's platter, so a stage's platter-scoped container
           queries answer here too — inline-size, because this box's height
           depends on what the stage needs */
        container-name: platter;
        container-type: inline-size;
        min-height: min(72vh, 680px);
        border: 1px solid var(--line);
        border-radius: 22px;
        /* clip, not hidden: a hidden box is still a scroll container, and
           would scroll to reveal a focused control a demo's transform has
           carried past the edge */
        overflow: clip;
        background:
          radial-gradient(
            70% 60% at 50% 40%,
            rgba(255, 59, 31, 0.1),
            transparent 60%
          ),
          var(--bg);
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

      .demo-body.is-theater .stage-row {
        order: -1;
        container-type: inline-size;
      }

      /* THE WELL'S ASPECT IS FOR A WELL. In theater the frame follows the
         window, capped at a square so a portrait phone does not turn the film
         into a tall strip; dvh follows the visible viewport as a phone's
         browser chrome opens and closes. The picture reframes to this box. */
      .demo-body.is-theater .stage-wrap {
        height: min(100vh, 100cqi);
        height: min(100dvh, 100cqi);
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
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
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
        padding: 0;
        border: 0;
        background: none;
        /* the pill is dark in either theme, so the type on it is light */
        color: rgba(255, 250, 242, 0.96);
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        white-space: nowrap;
        cursor: pointer;
      }

      .theater-built:hover {
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
        border-top: 1px solid var(--line);
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
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--ember);
      }

      .demo-body :deep(.dive-head h2) {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(22px, 3.4vw, 30px);
        font-weight: 700;
        line-height: 1.14;
        letter-spacing: -0.01em;
        text-wrap: balance;
        color: color-mix(in srgb, var(--ink) 82%, var(--bg-page));
      }

      .demo-body :deep(.dive-lede) {
        margin: 0;
        font-size: 15px;
        line-height: 1.65;
        color: color-mix(in srgb, var(--ink) 68%, var(--bg-page));
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
        color: var(--ember);
      }

      .demo-body :deep(.dd-fn::after) {
        flex: 1;
        height: 1px;
        background: var(--line);
        content: '';
      }

      .demo-body :deep(.dd-fn span) {
        color: var(--ink-faint);
      }

      .demo-body :deep(.dd h3) {
        max-width: 30ch;
        margin: 0;
        font-family: var(--font-display);
        font-size: 19px;
        font-weight: 700;
        line-height: 1.22;
        text-wrap: balance;
        color: color-mix(in srgb, var(--ink) 80%, var(--bg-page));
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
        color: color-mix(in srgb, var(--ink) 68%, var(--bg-page));
      }

      .demo-body :deep(.dd-col strong) {
        font-weight: 600;
        color: color-mix(in srgb, var(--ink) 82%, var(--bg-page));
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

      /* the notes' type, lifted a step in the dark palette, where the
         page-mixed greys above sit too far back */
      .choreo-site:not([data-theme='light']) .demo-body :deep(.dive-head h2),
      .choreo-site:not([data-theme='light']) .demo-body :deep(.dd-col strong) {
        color: #e6dfd6;
      }

      .choreo-site:not([data-theme='light']) .demo-body :deep(.dive-lede),
      .choreo-site:not([data-theme='light']) .demo-body :deep(.dd-col p) {
        color: #d2c9bf;
      }

      .choreo-site:not([data-theme='light']) .demo-body :deep(.dd h3) {
        color: #d4cbc2;
      }

      /* The notes' diagrams: a shared vocabulary of plates, boxes, rules and
         labels, drawn in each note's inline SVG and styled once here. */
      .demo-body :deep(.dd-fig) {
        margin: 2px 0 0;
        padding: 16px 16px 13px;
        border: 1px solid var(--line);
        border-radius: 16px;
        /* a light tint, capped at 4%: a dark tint over an already dark page
           does not read as a surface of its own */
        background: rgba(var(--surface-tint-rgb), 0.04);
        /* a wide drawing scrolls inside its own box rather than the page */
        overflow-x: auto;
      }

      .demo-body :deep(.dd-fig figcaption) {
        max-width: 76ch;
        margin-top: 13px;
        padding-top: 11px;
        border-top: 1px solid var(--line);
        font-family: var(--font-mono);
        font-size: 11px;
        line-height: 1.6;
        color: var(--ink-faint);
      }

      .demo-body :deep(.dd-fig figcaption b) {
        font-weight: 500;
        color: var(--ink-dim);
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
        fill: var(--bg);
        stroke: var(--line);
      }

      .demo-body :deep(.dg-box) {
        fill: var(--bg-elev);
        stroke: var(--line-strong);
      }

      .demo-body :deep(.dg-boxcop) {
        fill: var(--bg-elev);
        stroke: var(--copper);
      }

      .demo-body :deep(.dg-hot) {
        fill: rgba(255, 59, 31, 0.16);
        stroke: var(--ember);
      }

      .demo-body :deep(.dg-band) {
        fill: rgba(var(--ink-rgb), 0.04);
      }

      .demo-body :deep(.dg-rule) {
        fill: none;
        stroke: var(--line-strong);
      }

      .demo-body :deep(.dg-hair) {
        fill: none;
        stroke: var(--line);
      }

      .demo-body :deep(.dg-cop) {
        fill: none;
        stroke: var(--copper);
      }

      .demo-body :deep(.dg-emberline) {
        fill: none;
        stroke: var(--ember);
      }

      .demo-body :deep(.dg-hotline) {
        fill: none;
        stroke: var(--ember-hot);
        stroke-width: 2;
      }

      .demo-body :deep(.dg-inkline) {
        fill: none;
        stroke: var(--ink);
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
        fill: var(--ink-faint);
      }

      .demo-body :deep(.dg-arrow) {
        fill: var(--ink-faint);
      }

      .demo-body :deep(.dg-hand) {
        fill: var(--ink);
        stroke: var(--bg);
        stroke-width: 0.8;
      }

      .demo-body :deep(.dg-t) {
        font-family: var(--font-mono);
        font-size: 11px;
        fill: var(--ink);
      }

      .demo-body :deep(.dg-t.is-hot) {
        fill: var(--ember-hot);
      }

      .demo-body :deep(.dg-t.is-dim) {
        fill: var(--ink-dim);
      }

      .demo-body :deep(.dg-t.is-faint) {
        fill: var(--ink-faint);
      }

      .demo-body :deep(.dg-t.is-cop) {
        fill: var(--copper);
      }

      .demo-body :deep(.dg-eb) {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 1.4px;
        fill: var(--ink-faint);
      }

      .demo-body :deep(.dg-h) {
        font-family: var(--font-display);
        font-size: 15px;
        font-weight: 700;
        fill: var(--ink);
      }

      .demo-body :deep(.dg-h.is-hot) {
        fill: var(--ember-hot);
      }

      .walk {
        margin-top: 26px;
      }

      .walk-note {
        max-width: 68ch;
        margin: 26px 0 10px;
        color: var(--ink-dim);
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
        color: var(--ink-dim);
      }

      .pager > :deep(a) {
        min-width: 0;
        max-width: 48%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media (hover: hover) {
        .pager > :deep(a:hover) {
          color: var(--ink);
        }
      }

      /* a phone frame has no room for a byline beside the mark */
      @media (max-width: 700px) {
        .theater-built {
          display: none;
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
