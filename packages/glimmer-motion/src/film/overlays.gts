import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { Choreo } from '../choreo.gts';
import motion from '../motion.ts';
import type { Beat, ElementModifier } from './types.ts';

export interface InsertSignature {
  Args: {
    beat: Beat;
    /** the photograph failed to load: drop the plate */
    missing: () => void;
    src: string;
  };
}

/**
 * THE PHOTOGRAPH, cut in beside the model. The model is a model, and
 * there is a limit to what a film can claim with one; a real building at
 * the moment the commentary names it settles the claim. Wiped rather
 * than faded — a fade says "meanwhile", a wipe says "and here it is" —
 * and it carries its own credit.
 */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Insert extends Component<InsertSignature> {
  <template>
    <Choreo class='cf-photo' as |g|>
      {{#each (array @beat) key='id' as |b|}}
        <figure class='is-{{b.mode}}' {{motion id='photo' role='shot'}}>
          <img src={{@src}} alt='' {{on 'error' @missing}} />
          <figcaption>
            <span class='cf-photo-cap'>{{b.photo.caption}}</span>
            <span class='cf-photo-cr'>{{b.photo.credit}}</span>
          </figcaption>
        </figure>
      {{/each}}
      <g.Tween
        @of={{g.inserted 'shot'}}
        @clipPath={{array 'inset(0 100% 0 0)' 'inset(0 0% 0 0)'}}
        @duration={{0.62}}
        @ease={{array 0.22 1 0.36 1}}
      />
      <g.Tween
        @of={{g.removed 'shot'}}
        @opacity={{0}}
        @duration={{0.24}}
        @ease='easeIn'
      />
    </Choreo>
  </template>
}

export interface CaptionsSignature {
  Args: {
    /** the line being spoken */
    line?: string;
  };
}

/** CAPTIONS: the narration, printed — an accessibility track, and before
 *  any voice exists the only way to find out a line is too long */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Captions extends Component<CaptionsSignature> {
  <template>
    {{#if @line}}
      <p class='cf-subs'>{{@line}}</p>
    {{/if}}
  </template>
}

export interface TrackSignature {
  Args: {
    /** hands the film its leader, tether and ring */
    wire: ElementModifier<SVGSVGElement>;
  };
}

/**
 * THE GLASS keeps only what must connect DOM to world — the leader from a
 * caption, the mark's tether, the ring on a named point — projected
 * every frame by the film. The traces themselves live IN the scene.
 */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Track extends Component<TrackSignature> {
  <template>
    <svg class='cf-track' aria-hidden='true' {{@wire}}>
      <line class='cf-leader' x1='0' y1='0' x2='0' y2='0' />
      <line class='cf-tether' x1='0' y1='0' x2='0' y2='0' />
      <circle cx='0' cy='0' r='7' pathLength='1' />
    </svg>
  </template>
}

export interface StampSignature {
  Args: {
    /** a new element per step, so the strike replays from its own first frame */
    step: number;
    word: string;
  };
}

/** THE STAMP: a hanko, not a title — it lands hard, settles at once, and
 *  is simply replaced by the next; the lineup's roll call */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Stamp extends Component<StampSignature> {
  <template>
    {{#if @word}}
      {{#each (array @step) key='@identity'}}
        <p class='cf-stamp' aria-hidden='true'>{{@word}}</p>
      {{/each}}
    {{/if}}
  </template>
}

function array<T>(...items: T[]): T[] {
  return items;
}
