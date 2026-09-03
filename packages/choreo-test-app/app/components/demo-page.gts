import { array, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { pageTitle } from 'ember-page-title';
import { motion } from 'glimmer-motion';
import { ChoreoMark } from 'test-app/components/choreo-mark';
import { CodeBox } from 'test-app/components/code-box';
import { SpeedPicker } from 'test-app/components/speed-picker';
import { type DemoEntry, neighbors } from 'test-app/lib/catalog';
import { highlightSample } from 'test-app/lib/highlight';
import type TheaterService from 'test-app/services/theater';

/* an empty models tuple for a route with no dynamic segment */
const EMPTY: string[] = [];

export class DemoPage extends Component<{
  Args: { model?: DemoEntry };
}> {
  get near() {
    return this.args.model ? neighbors(this.args.model.id) : {};
  }

  get sample() {
    return this.args.model ? highlightSample(this.args.model.sample) : '';
  }

  @service declare private theater: TheaterService;

  /** only a demo with a film in its stage has a theater to enter */
  get hasTheater(): boolean {
    return this.args.model?.theater === true;
  }

  get inTheater(): boolean {
    return this.hasTheater && this.theater.on;
  }

  /**
   * The hash is the state, so it is read on the way in and followed
   * after — and dropped on the way out, because a demo with no film
   * must not inherit the last film's mode.
   */
  private house = modifier(() => {
    if (!this.hasTheater) {
      return;
    }
    this.theater.attach();
    return () => this.theater.detach();
  });

  /**
   * The app's own bar carries the mark at the top LEFT. In theater the
   * bar is gone and the mark is drawn over the picture at the top
   * right, so the two are never on screen together.
   */
  private dress = modifier((_el: Element, [on_]: [boolean]) => {
    document.body.classList.toggle('is-theater', on_);
    return () => document.body.classList.remove('is-theater');
  });

  private leaveTheater = () => this.theater.enter(false);

  <template>
    {{#if @model}}
      {{pageTitle @model.title}}
      {{! THE BODY IS A WRAPPER THAT USUALLY IS NOT THERE. `display:
          contents` means it generates no box at all, so the page lays
          out exactly as it did before it existed — and in theater it
          becomes a flex column, which is what lets the player be
          re-ORDERED to the front without being re-PARENTED. Moving an
          iframe in the DOM reloads it, and a film that restarts when
          you ask to see it bigger is not a film you can watch. }}
      <div
        class="demo-body {{if this.inTheater 'is-theater'}}"
        {{this.house}}
        {{this.dress this.inTheater}}
      >
        {{! "How this works" is chrome, not page: it lives beside the control
            that opens it, so a route change cannot reveal or take it away }}
        <article class="demo-head" data-demo={{@model.id}}>
          {{! the pager is at the foot of the page, past the code — which is a
            long way to scroll to say "next". The same link, where you are
            already looking. }}
          <div class="demo-nav" {{motion role="furniture"}}>
            <LinkTo @route="index" class="back back-all">
              <span class="back-arrow" aria-hidden="true">←</span>
              All examples
            </LinkTo>
            {{#if this.near.next}}
              <LinkTo
                @route={{if this.near.next.route this.near.next.route "demo"}}
                @models={{if
                  this.near.next.route
                  EMPTY
                  (array this.near.next.id)
                }}
                class="back next-demo"
              >
                Next
                <b>{{this.near.next.title}}</b>
                →
              </LinkTo>
            {{/if}}
          </div>
          {{! the transparent counterpart to the card's own `.card-meta`: not
            for layout — .demo-head already spaced these — but so the return
            trip has a SECOND box to tween into, the same shape the gallery
            already has, rather than one box (the stage) doing all the work
            while the metadata just appears }}
          {{! the same ids the gallery card's pieces carry: the crossing pairs
            them and each pair is one flight — the stage, and the same three
            lines of type, set twice }}
          <div class="demo-meta">
            <p
              class="kicker"
              {{motion id=(concat "group-" @model.id) role="type"}}
            >
              {{@model.group}}
              {{#if @model.notes}}
                <span class="kicker-badge">Deep Dive</span>
              {{/if}}
            </p>
            <h1 {{motion id=(concat "title-" @model.id) role="type"}}>
              {{@model.title}}
            </h1>
            <p
              class="lede"
              {{motion id=(concat "lede-" @model.id) role="type"}}
            >
              {{@model.lede}}
            </p>
          </div>
          {{! one id on every demo page: between two demos the pills pair and
            the crossfade of identical content is invisible — the old
            "conditionally steady" special case, said as an ordinary pair }}
          <div class="apis" {{motion id="apis" role="chrome"}}>
            {{#each @model.apis as |api|}}
              <code class="api">{{api}}</code>
            {{/each}}
          </div>
        </article>
        {{! The arrows are SIBLINGS of the stage, not children of it.

          `.stage-wrap` is one half of the shared element that flies out of
          the gallery card, so whatever is inside it travels inside that
          snapshot. Chrome for stepping through demos is not part of the demo:
          it stays where it is, in the page's own layer, and only sits over
          the stage's edges. }}
        {{#if @model.slowmo}}
          <SpeedPicker />
        {{/if}}
        <div class="stage-row">
          <div
            class="stage-wrap"
            {{motion id=(concat "stage-" @model.id) role="stage"}}
          >
            {{#let @model.Example as |Example|}}
              <Example />
            {{/let}}
            {{! THE MARK, in theater only. On the page proper the app's own
              bar carries it at the top left; drawing a second one here
              would be the same logo twice on one screen. In theater the
              bar is gone, so this is the only one — and it is also the
              way out, because the thing a viewer wants after the film
              is how it was made. }}
            {{#if this.inTheater}}
              <div class="theater-mark">
                <ChoreoMark />
                <button
                  type="button"
                  class="theater-built"
                  {{on "click" this.leaveTheater}}
                >How this is built</button>
              </div>
            {{/if}}
          </div>
        </div>
        {{! role='late': the code can wait for the move to land — the crossing
          fades it in after the flight, and only if a viewport can see it }}
        <section class="sample" aria-label="Code" {{motion role="late"}}>
          <p class="sample-label">Glimmer</p>
          <pre><code>{{this.sample}}</code></pre>
        </section>
        {{! ...and, for a demo whose subject is its DATA, the data. A film
            is a table: the shot list is what an agent edits and what a
            person directs, so quoting it is worth more than describing
            it. }}
        {{#if @model.walkthrough}}
          <section class="walk" aria-label="Walkthrough" {{motion role="late"}}>
            {{#each @model.walkthrough as |step|}}
              <p class="walk-note">{{step.note}}</p>
              <CodeBox @label={{step.label}} @source={{step.source}} />
            {{/each}}
          </section>
        {{/if}}
        {{! How to use it, then how it works — in that order, because nobody
          needs the second one to get started. Most demos are one idea and the
          sample says it; the ones that are not bring their own long half. }}
        {{#if @model.notes}}
          {{#let @model.notes as |Notes|}}
            <Notes />
          {{/let}}
        {{/if}}
        <nav class="pager" {{motion role="late"}}>
          {{#if this.near.prev}}
            <LinkTo
              @route={{if this.near.prev.route this.near.prev.route "demo"}}
              @models={{if
                this.near.prev.route
                EMPTY
                (array this.near.prev.id)
              }}
            >
              ←
              {{this.near.prev.title}}
            </LinkTo>
          {{else}}
            <span></span>
          {{/if}}
          {{#if this.near.next}}
            <LinkTo
              @route={{if this.near.next.route this.near.next.route "demo"}}
              @models={{if
                this.near.next.route
                EMPTY
                (array this.near.next.id)
              }}
            >
              {{this.near.next.title}}
              →
            </LinkTo>
          {{/if}}
        </nav>
      </div>
    {{/if}}
  </template>
}
