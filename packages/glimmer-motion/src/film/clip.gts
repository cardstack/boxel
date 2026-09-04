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

  /**
   * THE LOOK THIS CLIP IS WEARING, as a CSS filter — composed in the same
   * order the picture's own shader composes its grade (saturate, then
   * contrast, then brightness, then sepia and hue), because filter order
   * is not commutative and the two should agree about what a number
   * means. Blur goes last, where a lens would put it.
   *
   * It rides the MEDIA, not the figure, so an inset's caption and its card
   * are not graded with the footage.
   */
  get look(): string {
    const l = this.args.spec.look;
    if (!l) {
      return '';
    }
    const f: string[] = [];
    if (l.sat !== undefined) {
      f.push(`saturate(${l.sat})`);
    }
    if (l.con !== undefined) {
      f.push(`contrast(${l.con})`);
    }
    if (l.bri !== undefined) {
      f.push(`brightness(${l.bri})`);
    }
    if (l.sepia !== undefined) {
      f.push(`sepia(${l.sepia})`);
    }
    if (l.gray !== undefined) {
      f.push(`grayscale(${l.gray})`);
    }
    if (l.hue !== undefined) {
      f.push(`hue-rotate(${l.hue}deg)`);
    }
    if (l.blur !== undefined) {
      f.push(`blur(${l.blur}px)`);
    }
    const out = f.length ? [`filter:${f.join(' ')}`] : [];
    if (l.opacity !== undefined) {
      out.push(`opacity:${l.opacity}`);
    }
    return out.join(';');
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
              style={{this.look}}
              muted={{this.muted}}
              playsinline
              preload='auto'
              {{@mount @lane}}
            ></video>
          {{else if (eq @spec.kind 'image')}}
            <img src={{@src}} style={{this.look}} alt='' {{@mount @lane}} />
          {{else}}
            {{#if @freeze}}
              <img
                src={{@freeze}}
                style={{this.look}}
                alt=''
                {{@mount @lane}}
              />
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
