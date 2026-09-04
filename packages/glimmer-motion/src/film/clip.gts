import { array } from '@ember/helper';
import Component from '@glimmer/component';

import { Choreo } from '../choreo.gts';
import motion from '../motion.ts';
import type { ClipSpec, ClipState } from './clips.ts';
import type { ElementModifier } from './types.ts';

export interface ClipSignature {
  Args: {
    /** the picture, read back, when the clip is a freeze */
    freeze?: string;
    /** a new element per clip window, so the entrance replays */
    key: string;
    /** which lane this clip is on: the film's own handle is per lane */
    lane: number;
    /** the film's handle on the media element, for the per-frame sync */
    mount: ElementModifier<HTMLElement, [number]>;
    spec: ClipSpec;
    /** the resolved source, under `assets` */
    src: string;
    state: ClipState;
  };
}

/**
 * A CLIP ON THE PICTURE. A video, a still or a freeze of the picture
 * itself, standing over the frame for its window — full frame, or as an
 * inset with its caption like the photograph. The media is not played by
 * the browser's own clock: the film writes its source time every frame
 * (a paused element seeked, a playing one corrected), so a clip is where
 * the clock says it is whether the film played there or was scrubbed
 * there. It arrives the way the insert does — wiped in — and leaves in a
 * short fade.
 */
export class Clip extends Component<ClipSignature> {
  /** a pip is placed by the score, in percent of the frame */
  get place(): string {
    const c = this.args.spec;
    if (c.fit !== 'pip') {
      return '';
    }
    return [
      `left:${c.x ?? 66}%`,
      `top:${c.y ?? 10}%`,
      `width:${c.w ?? 30}%`,
      `border-radius:${c.radius ?? 0}%`,
      `--cf-pip-fade:${c.fade ?? 0.4}s`,
    ].join(';');
  }

  /** a pip fades; the editorial card is wiped in and out */
  get isPip(): boolean {
    return this.args.spec.fit === 'pip';
  }

  /** seconds a pip takes to arrive and to go */
  get fade(): number {
    return this.args.spec.fade ?? 0.4;
  }

  get muted(): boolean {
    return !(this.args.spec.volume && this.args.spec.volume > 0);
  }

  get volume(): number {
    return Math.max(0, Math.min(1, this.args.spec.volume ?? 0));
  }

  <template>
    <Choreo
      @id='clip'
      class='cf-clip is-{{if @spec.fit @spec.fit "inset"}} is-{{@state}}'
      as |g|
    >
      {{#each (array @key) key='@identity'}}
        <figure style={{this.place}} {{motion id='clip' role='clip'}}>
          {{#if (eq @spec.kind 'video')}}
            <video
              src={{@src}}
              muted={{this.muted}}
              playsinline
              preload='auto'
              {{@mount @lane}}
            ></video>
          {{else if (eq @spec.kind 'image')}}
            <img src={{@src}} alt='' {{@mount @lane}} />
          {{else}}
            {{#if @freeze}}
              <img src={{@freeze}} alt='' {{@mount @lane}} />
            {{/if}}
          {{/if}}
          {{#if @spec.caption}}
            <figcaption>
              <span class='cf-clip-cap'>{{@spec.caption}}</span>
              {{#if @spec.credit}}
                <span class='cf-clip-cr'>{{@spec.credit}}</span>
              {{/if}}
            </figcaption>
          {{/if}}
        </figure>
      {{/each}}
      {{#if this.isPip}}
        {{! A PIP FADES. It is a layer, not a photograph pinned to the
        page, so it arrives and leaves the way a layer does — on its own
        length, which the score sets. }}
        <g.Tween
          @of={{g.inserted 'clip'}}
          @opacity={{array 0 1}}
          @scale={{array 1.04 1}}
          @duration={{this.fade}}
          @ease='easeOut'
        />
        <g.Tween
          @of={{g.removed 'clip'}}
          @opacity={{0}}
          @duration={{this.fade}}
          @ease='easeIn'
        />
      {{else}}
        <g.Tween
          @of={{g.inserted 'clip'}}
          @clipPath={{array 'inset(0 100% 0 0)' 'inset(0 0% 0 0)'}}
          @duration={{0.62}}
          @ease={{array 0.22 1 0.36 1}}
        />
        <g.Tween
          @of={{g.removed 'clip'}}
          @opacity={{0}}
          @duration={{0.24}}
          @ease='easeIn'
        />
      {{/if}}
    </Choreo>
  </template>
}

function eq(a: unknown, b: unknown): boolean {
  return a === b;
}
