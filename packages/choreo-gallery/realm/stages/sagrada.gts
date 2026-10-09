import type { TOC } from '@ember/component/template-only';

import { GalleryDemo, type StageSignature } from '../demo';
import { realmFile } from '../lib/realm-url';
import SagradaNotes from '../notes/sagrada';
import { FilmStage } from '../shell/film-stage';
import { FilmTile } from '../shell/film-tile';

/* one frame of the film, read back through the picture's own snapshot();
   the type over it is HTML, not baked in */
const POSTER = realmFile('asset/sagrada-poster.webp');
/* where the subject sits in that still: the tile and the page crop to it */
const FOCUS = '38% 50%';
/* the film's own inks, on the centenary night the still is taken from: the
   stone lit gold against a cold city, which is also the one frame where the
   building is finished and nothing is cropped off the top */
const PALETTE =
  '--ft-key:#e2b360;--ft-ink:rgba(248,250,255,0.97);' +
  '--ft-sub:rgba(216,226,240,0.74);--ft-sky:#131922;' +
  '--ft-floor:rgba(9,13,20,0.88);--ft-ring:rgba(226,208,170,0.3)';

/**
 * The Sagrada Família film's faces: its poster in the grid, the film itself on its
 * page. The poster opens the film's page in theater; the tile's caption, the
 * card's own link, opens the page.
 */
const SagradaStage: TOC<StageSignature> = <template>
  <FilmStage
    class='sg-face'
    @face={{@face}}
    @theater={{@theater}}
    @film='sagrada'
    @title='Sagrada Família — the film'
    @ground='#e8dccb'
    @sizeKey='choreo-gallery:sagrada-size'
    @poster={{POSTER}}
    @focus={{FOCUS}}
  >
    <:tile>
      <FilmTile
        @eyebrow='A construction study · 1882—'
        @label='Watch Sagrada Família'
        @line='A hundred and forty-four years, in four minutes'
        @name='Sagrada'
        @open={{@open}}
        @focus={{FOCUS}}
        @palette={{PALETTE}}
        @poster={{POSTER}}
      />
    </:tile>
  </FilmStage>
</template>;

export class SagradaDemo extends GalleryDemo {
  static stage = SagradaStage;
  static notes = SagradaNotes;
  static well = 'tall' as const;
}
