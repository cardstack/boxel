/**
 * THE PICTURE, AS A COMPONENT.
 *
 * A film does not own a picture; it is handed one. Until Phase 2 it was
 * handed fourteen arguments about the page behind the iframe — where it
 * lives, where its files are, how it is seated before the door, the rig's
 * mid-height, how much frosted city a frame can carry — and none of them
 * were about the edit. Now the picture is a component in the film's
 * `<:picture>` block, and those are ITS arguments:
 *
 *   <Film @name='sagrada' @seek='exact' @clock={{CLOCK}}>
 *     <:picture>
 *       <IframePicture @src={{this.src}} @assets={{this.assets}}
 *         @standing={{T_TODAY}} @seat={{seat}} @rigMid={{6.6}} @cityGlass={{0.16}}
 *         @grades={{GRADES}} @lookFx={{LOOK_FX}} @title='Sagrada Família' />
 *     </:picture>
 *     <:default as |f|>…the score…</:default>
 *   </Film>
 *
 * The component renders nothing; it REGISTERS its spec with the film (the
 * block yields the registrar), a frame after render so the write never
 * lands inside the render that reads it. It also declares the picture's
 * ADJUSTMENTS — the typed knobs a score may hold on it, `f.picture.*` —
 * which for the iframe picture are Look, Weather, Winter, Sun, Light,
 * Set and Build (`graph/adjust.gts`). A third kind of picture (a video, a
 * three.js scene in the same document) is another component with its own
 * spec and its own adjustments; the film never sees the difference.
 */
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import { IFRAME_PICTURE } from './graph/adjust.gts';
import type { FilmGrade, LookFx, Picture } from './types.ts';

/** what a picture tells the film about itself, once */
export interface PictureSpec {
  /** the editorial accent on a dark frame, and on a light one (the scene's own palette when unset) */
  accent?: { dark: string; light?: string };
  /** the adjustments a score may hold on this picture, yielded as `f.picture.*` */
  adjustments: typeof IFRAME_PICTURE;
  /** where the picture's files live: `vo/<id>.mp3`, `luts/*.cube`, photographs */
  assets: string;
  /** how much of a frosted city a film frame can carry (the page's own is 0.30) */
  cityGlass?: number;
  /** how much a passing cloud thickens the air */
  cloudHaze?: number;
  /** how much each mood brightens the frame */
  gradeLum?: Record<string, number>;
  /** the moods, as numbers the glass can take */
  grades?: Record<string, FilmGrade>;
  /** how each named look is worn */
  lookFx?: Record<string, LookFx>;
  /** how much of a stock the picture wears when a shot names one */
  lutAmount?: number;
  /** how the door is lit: the hour and the key light, degrees */
  poster?: { light?: { az: number; el: number }; theme?: number };
  /** the rig's mid-height: `lookY` is world height minus this */
  rigMid?: number;
  /**
   * THE SEAMS THIS PICTURE CAN RUN IN ITS OWN GLASS, by name. A join that
   * names one is handed to `Picture.seam` with its progress instead of
   * being drawn as an overlay in this document — which is the only way a
   * transition can be a SHADER, and the only way it can composite in
   * light. Declared the way `adjustments` is: the actor owns the
   * vocabulary, the film hands it values and knows nothing else about it.
   */
  seams?: string[];
  /** told once when the picture arrives, before the door: what it should show */
  seat?: (picture: Picture) => void;
  /** the picture's page, mounted in an iframe */
  src: string;
  /** an already-fetched page, for hosts that cannot navigate an iframe to raw HTML */
  srcdoc?: string;
  /** the page's clock at which the subject stands whole */
  standing: number;
  /** the iframe's accessible name */
  title: string;
  /** how type standing in the scene is set */
  worldType?: { family?: string; track?: number; weight?: number };
}

export interface IframePictureSignature {
  Args: Omit<PictureSpec, 'adjustments'> & {
    /** the film's registrar, yielded by its `<:picture>` block */
    register: (spec: PictureSpec | null) => void;
  };
}

/** a WebGL page in an iframe, addressed through the `Picture` port: both reference films' kind */
export class IframePicture extends Component<IframePictureSignature> {
  private pending = 0;

  private get spec(): PictureSpec {
    const a = this.args;
    return {
      accent: a.accent,
      adjustments: IFRAME_PICTURE,
      assets: a.assets,
      cityGlass: a.cityGlass,
      cloudHaze: a.cloudHaze,
      gradeLum: a.gradeLum,
      grades: a.grades,
      lookFx: a.lookFx,
      lutAmount: a.lutAmount,
      poster: a.poster,
      rigMid: a.rigMid,
      seams: a.seams,
      seat: a.seat,
      src: a.src,
      srcdoc: a.srcdoc,
      standing: a.standing,
      title: a.title,
      worldType: a.worldType,
    };
  }

  /** registers a frame after render, and again whenever an argument changes */
  private attach = modifier(() => {
    const spec = this.spec; // read here, so the modifier tracks every argument
    if (this.pending) {
      cancelAnimationFrame(this.pending);
    }
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.args.register(spec);
    });
    return () => {
      if (this.pending) {
        cancelAnimationFrame(this.pending);
        this.pending = 0;
      }
      this.args.register(null);
    };
  });

  <template>
    <span hidden data-film-picture {{this.attach}}></span>
  </template>
}
