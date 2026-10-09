import type { TOC } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';

import { GalleryDemo, type StageSignature } from '../demo';
import { realmFile } from '../lib/realm-url';
import SylvaNotes from '../notes/sylva';
import { FilmStage } from '../shell/film-stage';

/* a photograph of the world, the original's own frame */
const POSTER = realmFile('asset/sylva-poster.webp');
/* the theater door in the world's own greens */
const DOOR = htmlSafe(
  '--film-btn-rim:rgba(126,214,160,0.4);--film-btn-ground:rgba(6,18,12,0.62);' +
    '--film-btn-ink:#cfe9da;--film-btn-hover:rgba(20,44,30,0.85)',
);

/**
 * Sylva's faces. Forty thousand blades of moss and two shader roots is not a
 * thing to composite in a grid, so the tile is a PHOTOGRAPH of the world with
 * the title dropped on it, and the world itself only boots on the demo page,
 * in a frame of its own.
 */
const SylvaStage: TOC<StageSignature> = <template>
  <FilmStage
    class='sy-face'
    style={{DOOR}}
    @face={{@face}}
    @theater={{@theater}}
    @film='sylva'
    @title='Sylva — the living world'
    @ground='#4a4d44'
    @resizable={{false}}
    @sizeKey='choreo-gallery:sylva-size'
    @poster={{POSTER}}
    @focus='50% 62%'
  >
    <:tile>
      {{! a photograph of the world, the title's lower third, and one
        translucent door into the theater }}
      <div class='sy-tile'>
        <img class='sy-tile-poster' src={{POSTER}} alt='' />
        <div class='sy-tile-scrim' aria-hidden='true'></div>
        {{! the original's own play control: a dark disc with an iridescent
          rim, a quiet outer ring, and nothing to read }}
        {{#if @open}}
          <button
            type='button'
            class='sy-tile-tour'
            aria-label='Tour the living world'
            {{on 'click' @open}}
          ></button>
        {{else}}
          <span class='sy-tile-tour' aria-hidden='true'></span>
        {{/if}}
        <div class='sy-tile-third' aria-hidden='true'>
          <p class='sy-tile-eyebrow'>A field survey</p>
          <p class='sy-tile-name'>Sylva</p>
          <p class='sy-tile-line'>Step into the living world</p>
        </div>
      </div>
    </:tile>
  </FilmStage>
  <style scoped>
    .sy-tile {
      position: absolute;
      inset: 0;
      overflow: hidden;
      /* the photograph's own sky (threeui's misty sage), sampled from the
         frame — whatever the crop leaves uncovered fills invisibly */
      background: #4a4d44;
    }

    .sy-tile-poster {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: 50% 62%;
    }

    .sy-tile-scrim {
      position: absolute;
      inset: 0;
      /* shaded in the sky's own family, not the film's night blue */
      background:
        radial-gradient(
          60% 50% at 50% 44%,
          rgba(26, 28, 22, 0) 42%,
          rgba(26, 28, 22, 0.3) 100%
        ),
        linear-gradient(rgba(26, 28, 22, 0) 52%, rgba(20, 22, 17, 0.85) 100%);
    }

    .sy-tile-tour {
      position: absolute;
      left: 50%;
      top: 44%;
      width: 92px;
      height: 92px;
      padding: 0;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      /* the iridescent hairline: a conic sweep worn as the border */
      border: 1px solid transparent;
      background:
        linear-gradient(rgba(28, 31, 26, 0.55), rgba(28, 31, 26, 0.55))
          padding-box,
        conic-gradient(
            from 210deg,
            rgba(150, 185, 255, 0.75),
            rgba(255, 205, 150, 0.65),
            rgba(255, 255, 255, 0.22),
            rgba(150, 185, 255, 0.75)
          )
          border-box;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      cursor: pointer;
      transition: transform 200ms ease;
    }

    /* the quiet outer ring */
    .sy-tile-tour::before {
      content: '';
      position: absolute;
      inset: -30px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.28);
    }

    /* the play mark */
    .sy-tile-tour::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-42%, -50%);
      border-style: solid;
      border-width: 11px 0 11px 18px;
      border-color: transparent transparent transparent #ffffff;
    }

    .sy-tile-tour:hover {
      transform: translate(-50%, -50%) scale(1.06);
    }

    .sy-tile-third {
      position: absolute;
      left: 18px;
      bottom: 14px;
      right: 18px;
    }

    .sy-tile-eyebrow {
      margin: 0 0 4px;
      font:
        500 9px/1 ui-monospace,
        monospace;
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: #7ed6a0;
    }

    .sy-tile-name {
      margin: 0 0 2px;
      font:
        300 26px/1 ui-sans-serif,
        system-ui,
        sans-serif;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: rgba(226, 245, 232, 0.96);
    }

    .sy-tile-line {
      margin: 0;
      font:
        300 13px/1.3 ui-serif,
        Georgia,
        serif;
      color: #9fc2ac;
    }
  </style>
</template>;

export class SylvaDemo extends GalleryDemo {
  static stage = SylvaStage;
  static notes = SylvaNotes;
}
