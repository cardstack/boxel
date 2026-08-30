import { array, concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion } from 'glimmer-motion';

/**
 * "Jump to it and flash it" — the genre that is normally a scroll racing a
 * classList write racing a `setTimeout`, written as three steps on one clock.
 *
 * `c.Scroll` animates the sprite's own scroll container and yields to the
 * wheel, so a person who starts scrolling mid-jump keeps their scroll.
 * `c.Raise` promotes the row to the region's elevated layer for the length
 * of its window — above every stacking context AND outside the list's clip,
 * which is the part `z-index` alone cannot buy. And `c.Hold` puts the mark
 * on it: `@fill` decides whether the mark is released with the window or
 * kept, which is the difference between a flash and a selection.
 *
 * `@debug` on the region is the fourth control: it outlines every participant
 * and prints the pass — the changeset it measured, the cues it compiled — so
 * "my score did nothing" becomes a question with an answer rather than a
 * guess. It also warns about a removed participant no step names.
 */

const EASE = [0.32, 0.72, 0, 1] as const;
const TAKES = Array.from({ length: 24 }, (_, i) => ({
  id: `take-${i + 1}`,
  n: i + 1,
  slate: ['interior', 'exterior', 'insert', 'pickup'][i % 4] as string,
}));
const ALIGNS = ['start', 'center', 'end'] as const;
const eq = (a: string, b: string) => a === b;

export class Jump extends Component {
  takes = TAKES;
  aligns = ALIGNS;

  @tracked align: (typeof ALIGNS)[number] = 'center';
  @tracked keep = false;
  @tracked debug = false;
  @tracked target = '';
  /** a new number for every jump, so asking for the same row twice re-runs it */
  @tracked pass = 0;

  find = (id: string) => {
    this.target = id;
    this.pass += 1;
  };

  setAlign = (align: (typeof ALIGNS)[number]) => {
    this.align = align;
  };

  toggleKeep = () => {
    this.keep = !this.keep;
  };

  toggleDebug = () => {
    this.debug = !this.debug;
  };

  <template>
    <div class="ex jump-ex">
      <div class="jump-controls">
        <span class="jump-legend">@align</span>
        {{#each this.aligns key="@index" as |align|}}
          <button
            type="button"
            class={{if (eq this.align align) "chip is-on" "chip"}}
            {{on "click" (fn this.setAlign align)}}
          >{{align}}</button>
        {{/each}}
        <span class="jump-sep"></span>
        <button
          type="button"
          class={{if this.keep "chip is-on" "chip"}}
          {{on "click" this.toggleKeep}}
        >{{if this.keep "@fill — kept" "@fill — released"}}</button>
        <button
          type="button"
          class={{if this.debug "chip is-on" "chip"}}
          {{on "click" this.toggleDebug}}
        >@debug</button>
      </div>

      <div class="jump-asks">
        <button
          type="button"
          class="chip is-ask"
          {{on "click" (fn this.find "take-3")}}
        >take 3</button>
        <button
          type="button"
          class="chip is-ask"
          {{on "click" (fn this.find "take-11")}}
        >take 11</button>
        <button
          type="button"
          class="chip is-ask"
          {{on "click" (fn this.find "take-19")}}
        >take 19</button>
        <button
          type="button"
          class="chip is-ask"
          {{on "click" (fn this.find "take-24")}}
        >take 24</button>
      </div>

      <Choreo class="jump-region" @debug={{this.debug}} as |c|>
        <ol class="jump-list">
          {{#each this.takes key="id" as |take|}}
            <li class="jump-row" {{motion id=take.id role="row"}}>
              <span class="jump-n">{{take.n}}</span>
              <span class="jump-slate">{{take.slate}}</span>
              <span class="jump-bar"></span>
            </li>
          {{/each}}
        </ol>

        {{! The score is rendered from the first pass, not from the first
            click. A region does not collect a timeline on the pass that
            first renders it — so a score that appears in the same pass as
            the change it describes sits out that change and runs on the
            next one. With an empty target the steps select nothing and cost
            nothing; the first click then has a score waiting for it. }}
        {{#each (array this.pass) key="@identity" as |take|}}
          {{! The take number is in the name so that asking for the SAME row
              twice is a different score. A region declines a pass whose
              compiled tree fingerprints identical to the one already
              standing — that is what stops a neighbour's render restarting
              every run on a busy page — and two asks for take 11 compile
              the same tree unless something in it says which ask this is. }}
          <c.Sequence @name={{concat "take-" take}}>
            {{! the container's own scroll, on the timeline — and it yields
                the moment a wheel arrives }}
            <c.Scroll
              @of={{c.id this.target}}
              @align={{this.align}}
              @duration={{0.5}}
              @ease={{EASE}}
            />
            <c.Parallel>
              {{! and only once it has arrived: out of the list's clip for
                  the length of the window, with the shadow that says it left
                  the page. Raising DURING the scroll would pin the row to
                  where it stood when the lift began and the list would slide
                  out from under it. }}
              <c.Raise
                @of={{c.id this.target}}
                @shadow={{true}}
                @duration={{0.9}}
              />
              {{! the mark. @fill is the difference between a flash and a
                  selection: released with the window, or kept after it. }}
              <c.Hold
                @of={{c.id this.target}}
                @backgroundColor="var(--ember)"
                @color="#fff"
                @duration={{0.7}}
                @fill={{this.keep}}
              />
            </c.Parallel>
          </c.Sequence>
        {{/each}}
      </Choreo>
    </div>
  </template>
}

export default Jump;
