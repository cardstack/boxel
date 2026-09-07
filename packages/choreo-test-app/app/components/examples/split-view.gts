import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type Changeset, Choreo, motion, type Sprite } from 'glimmer-motion';
import { tuneSpring } from 'test-app/lib/demo-tuning';

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
    <div class="ex">
      <button type="button" class="replay" {{on "click" this.toggle}}>{{if
          this.split
          "Close"
          "Split"
        }}</button>
      <Choreo class={{if this.split "split is-split" "split"}} as |c|>
        <aside class="split-bar" {{motion id="split-bar"}}>
          <span class="split-dot"></span>
          <span class="split-dot"></span>
          <span class="split-dot"></span>
        </aside>
        <section class="split-content" {{motion id="split-content"}}>
          <b>Kiln log</b>
          <span>Four pours, one clean handoff.</span>
        </section>

        <c.Parallel>
          <c.Move
            @of={{c.id "split-bar"}}
            @spring={{tuneSpring "split" firm "firm"}}
          />
          <c.Spring
            @of={{c.id "split-content"}}
            @left={{this.leftRange}}
            @spring={{tuneSpring "split" firm "firm"}}
          />
        </c.Parallel>
      </Choreo>
    </div>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSpring('split', firm, 'firm');
