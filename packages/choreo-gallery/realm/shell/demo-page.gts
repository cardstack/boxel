import { concat, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { motion } from 'glimmer-motion';

import type { GalleryDemo } from '../demo';
import type { GalleryNavigation } from '../lib/navigation';
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

  <template>
    {{#let @demo.slug as |slug|}}
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
      <div class='stage-row'>
        <div
          class='stage-wrap'
          data-demo-stage
          {{motion id=(concat 'stage-' slug) role='stage'}}
        >
          <DemoStage @demo={{@demo}} />
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
