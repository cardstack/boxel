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
    /** the film's handle on the media element, for the per-frame sync */
    mount: ElementModifier<HTMLElement>;
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
  get muted(): boolean {
    return !(this.args.spec.volume && this.args.spec.volume > 0);
  }

  get volume(): number {
    return Math.max(0, Math.min(1, this.args.spec.volume ?? 0));
  }

  <template>
    <Choreo
      class='cf-clip is-{{if @spec.fit @spec.fit "inset"}} is-{{@state}}'
      as |g|
    >
      {{#each (array @key) key='@identity'}}
        <figure {{motion id='clip' role='clip'}}>
          {{#if (eq @spec.kind 'video')}}
            <video
              src={{@src}}
              muted={{this.muted}}
              playsinline
              preload='auto'
              {{@mount}}
            ></video>
          {{else if (eq @spec.kind 'image')}}
            <img src={{@src}} alt='' {{@mount}} />
          {{else}}
            {{#if @freeze}}
              <img src={{@freeze}} alt='' {{@mount}} />
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
    </Choreo>
  </template>
}

function eq(a: unknown, b: unknown): boolean {
  return a === b;
}
