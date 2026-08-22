import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type Changeset, Choreo, motion, type Sprite } from 'glimmer-motion';

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

  /** where the content starts: the bar's width before this pass */
  leftFrom = (_s: Sprite, cs: Changeset) =>
    cs.sprite({ id: 'split-bar' })!.initial!.parent.width;
  /** where it ends: the bar's width after */
  leftTo = (_s: Sprite, cs: Changeset) =>
    cs.sprite({ id: 'split-bar' })!.final!.parent.width;

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
          <c.Move @of={{c.id "split-bar"}} @spring={{firm}} />
          <c.Spring
            @of={{c.id "split-content"}}
            @left={{this.leftTo}}
            @from={{hash left=this.leftFrom}}
            @spring={{firm}}
          />
        </c.Parallel>
      </Choreo>
    </div>
  </template>
}
