import { type Changeset, Choreo, type Sprite } from '@cardstack/choreo';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneSpring } from '../lib/tuning';

const firm = { damping: 34, stiffness: 420 };

/**
 * boxel-motion's split-view: the content's `left` is not a number anyone
 * wrote down — it is the sidebar's measured width, before and after.
 */
export class SplitView extends Component {
  @tracked split = false;

  toggle = () => {
    this.split = !this.split;
  };

  /*
   * Where the content starts and ends: the bar's width, before and after — or
   * nothing at all.
   *
   * A property function runs against whatever changeset the region hands it,
   * and the bar is not always in it. Unmount this card (the gallery filter
   * does) and the region reconciles a changeset the bar has already left.
   * `cs.sprite()` returns null by contract, so asserting it away with `!` made
   * a torn-down region throw a TypeError inside the measure pass — which took
   * every other region on the page with it, and read as the whole gallery
   * disappearing. Nothing is on screen to animate in that case, so 0 is right.
   */
  /** a keyframe pair, both ends read off the bar's measurements — the
   *  from-and-to in one value, which is how a spring states its start now */
  leftRange = (_s: Sprite, cs: Changeset) => {
    const bar = cs.sprite({ id: 'split-bar' });
    return [bar?.initial?.parent.width ?? 0, bar?.final?.parent.width ?? 0];
  };

  <template>
    <div class='ex'>
      <button type='button' class='replay' {{on 'click' this.toggle}}>{{if
          this.split
          'Close'
          'Split'
        }}</button>
      <Choreo class={{if this.split 'split is-split' 'split'}} as |c|>
        <aside class='split-bar' {{motion id='split-bar'}}>
          <span class='split-dot'></span>
          <span class='split-dot'></span>
          <span class='split-dot'></span>
        </aside>
        <section class='split-content' {{motion id='split-content'}}>
          <b>Kiln log</b>
          <span>Four pours, one clean handoff.</span>
        </section>

        <c.Parallel>
          <c.Move
            @of={{c.id 'split-bar'}}
            @spring={{tuneSpring 'split' firm 'firm'}}
          />
          <c.Spring
            @of={{c.id 'split-content'}}
            @left={{this.leftRange}}
            @spring={{tuneSpring 'split' firm 'firm'}}
          />
        </c.Parallel>
      </Choreo>
    </div>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
           reads as a layout bug rather than as a stage, and the ones sized
           `min(Npx, 100%)` hit the frame exactly when the card is narrow.
           The block padding matters as much as the inline: on a stage tall
           enough to fill the platter, content flush against the top and bottom
           of the recess reads as overflowed rather than placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      .replay {
        position: absolute;
        top: 14px;
        right: 14px;
        z-index: 3;
        border: 1px solid var(--line-strong);
        background: rgba(var(--bg-rgb), 0.72);
        backdrop-filter: blur(8px);
        border-radius: 999px;
        padding: 7px 12px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      @media (hover: hover) {
        .replay:hover {
          color: var(--ink);
        }
      }

      .split {
        --bar: 0px;
        position: relative;
        width: min(92%, 420px);
        height: 200px;
        border: 1px solid var(--line-strong);
        border-radius: 14px;
        overflow: hidden;
        background: var(--bg-elev);
      }

      .split.is-split {
        --bar: 140px;
      }

      .split-bar {
        position: absolute;
        inset: 0 auto 0 0;
        /* The content sits at `left: var(--bar)`, so the bar must BE exactly that
           wide at every value — including 0. Horizontal padding or a border would
           put a floor under it (border-box clamps at padding + border), and CSS and
           the measured width would disagree until the first run. So the inset lives
           on the dots instead. */
        box-sizing: border-box;
        width: var(--bar);
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px 0;
        background: var(--bg-spot);
        overflow: hidden;
      }

      .split-dot {
        flex: none;
        margin: 0 14px;
        width: 60%;
        height: 8px;
        border-radius: 999px;
        background: var(--line-strong);
      }

      .split-content {
        position: absolute;
        top: 0;
        bottom: 0;
        left: var(--bar);
        width: 280px;
        display: grid;
        align-content: center;
        gap: 6px;
        padding: 22px;
        color: var(--ink);
      }

      .split-content b {
        font-family: var(--font-display);
        font-size: 18px;
      }

      .split-content span {
        color: var(--ink-dim);
        font-size: 13px;
      }
    </style>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSpring('split', firm, 'firm');

export class SplitViewDemo extends GalleryDemo {
  static stage = SplitView;
}
