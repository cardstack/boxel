import type { TOC } from '@ember/component/template-only';

import { GalleryDemo, type StageSignature } from '../demo';
import { realmFile } from '../lib/realm-url';
import TowersNotes from '../notes/towers';
import { FilmStage } from '../shell/film-stage';
import { FilmTile } from '../shell/film-tile';

/* one frame of the film, read back through the picture's own snapshot();
   the type over it is HTML, not baked in */
const POSTER = realmFile('asset/towers-poster.webp');
/* the film's own inks: the keep's evening, its gold, its paper */
const PALETTE =
  '--ft-key:#e0aa52;--ft-ink:rgba(255,247,232,0.97);' +
  '--ft-sub:rgba(246,230,201,0.72);--ft-sky:#2a1e10;' +
  '--ft-floor:rgba(28,19,8,0.86);--ft-ring:rgba(240,214,164,0.32)';

/**
 * The Towers film's faces: its poster in the grid, the film itself on its
 * page. The poster opens the film's page in theater; the tile's caption, the
 * card's own link, opens the page.
 */
const TowersStage: TOC<StageSignature> = <template>
  <FilmStage
    class='tw-face'
    @face={{@face}}
    @theater={{@theater}}
    @film='towers'
    @title='Towers — the film'
    @ground='#ecdcbc'
    @sizeKey='choreo-gallery:towers-size'
  >
    <:tile>
      <FilmTile
        @eyebrow='A construction study'
        @label='Watch Towers'
        @line='Not a video — a film cut by a score'
        @name='Towers'
        @open={{@open}}
        @focus='32% 52%'
        @palette={{PALETTE}}
        @poster={{POSTER}}
      />
    </:tile>
  </FilmStage>
</template>;

export class TowersDemo extends GalleryDemo {
  static stage = TowersStage;
  static notes = TowersNotes;
  static well = 'wide' as const;
}
