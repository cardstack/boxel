import {
  CardDef,
  Component,
  field,
  linksToMany,
} from '@cardstack/base/card-api';

import { GalleryDemo, GROUPS } from './demo';
import { ChoreoRoot } from './shell/choreo-root';
import { GalleryGrid, type GalleryTile } from './shell/gallery-grid';
import { SiteFrame } from './shell/site-frame';

/**
 * The linked demos that have loaded. While the card is prerendered, a link
 * that has not been loaded yet is an empty slot in the list.
 */
function loadedDemos(demos: unknown[] | undefined): GalleryDemo[] {
  return (demos ?? []).filter((demo): demo is GalleryDemo => Boolean(demo));
}

/**
 * The gallery site's front page: the hero and a grid of every demo.
 *
 * Each tile is the demo card itself, rendered by the host in its fitted
 * format, so the host owns the move to a demo: a click opens the demo card in
 * the stack, or as the next page of a published site, with the URL and Back
 * the host gives every card.
 */
class Isolated extends Component<typeof ChoreoGallery> {
  /** each loaded demo, with the host's component for its card */
  get tiles(): GalleryTile[] {
    let cards = this.args.fields.demos;
    return (this.args.model.demos ?? []).flatMap((demo, index) => {
      let Card = cards[index];
      return demo && Card ? [{ demo: demo as GalleryDemo, Card }] : [];
    });
  }

  /**
   * Opens a demo card through the host. In interact mode the host's overlay
   * takes a click on a tile before it gets here; a published site has no
   * overlay, and this is the click's way in.
   */
  open = (demo: GalleryDemo) => {
    this.args.viewCard?.(demo, 'isolated');
  };

  <template>
    <SiteFrame>
      <GalleryGrid @tiles={{this.tiles}} @onOpen={{this.open}} />
    </SiteFrame>
  </template>
}

/** a summary of the gallery, for wherever it is listed or linked */
class Summary extends Component<typeof ChoreoGallery> {
  get count() {
    return loadedDemos(this.args.model.demos).length;
  }

  <template>
    <ChoreoRoot class='summary'>
      <p class='summary-kicker'>Choreo gallery</p>
      <p class='summary-title'>Motion, <em>Choreographed.</em></p>
      <p class='summary-count'>{{this.count}} demos</p>
      <ul class='summary-groups'>
        {{#each GROUPS as |group|}}
          <li>{{group}}</li>
        {{/each}}
      </ul>
    </ChoreoRoot>
    <style scoped>
      .summary {
        display: flex;
        flex-direction: column;
        gap: 8px;
        height: 100%;
        padding: 16px 18px;
        overflow: hidden;
      }

      .summary-kicker,
      .summary-count {
        margin: 0;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ember-hot);
      }

      .summary-count {
        color: var(--ink-dim);
      }

      .summary-title {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 1.6rem;
        letter-spacing: -0.04em;
        line-height: 1;
      }

      .summary-title em {
        font-style: normal;
        color: var(--copper);
      }

      .summary-groups {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 4px 0 0;
        padding: 0;
        list-style: none;
      }

      .summary-groups li {
        padding: 2px 8px;
        border: 1px solid var(--line);
        border-radius: 999px;
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }
    </style>
  </template>
}

export class ChoreoGallery extends CardDef {
  static displayName = 'Choreo Gallery';
  static prefersWideFormat = true;

  /** the catalog, in the order the gallery shows it */
  @field demos = linksToMany(GalleryDemo);

  static isolated = Isolated;
  static embedded = Summary;
  static fitted = Summary;
}
