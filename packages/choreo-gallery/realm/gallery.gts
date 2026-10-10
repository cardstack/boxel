import {
  CardDef,
  Component,
  field,
  linksToMany,
} from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { setMotionSpeed } from 'glimmer-motion';

import { GalleryDemo, GROUPS } from './demo';
import { Crossing } from './lib/crossing';
import type { GalleryNavigation } from './lib/navigation';
import { factor } from './lib/tempo';
import { Theater } from './lib/theater';
import { ChoreoRoot } from './shell/choreo-root';
import { DemoPage } from './shell/demo-page';
import { GalleryGrid } from './shell/gallery-grid';
import { SiteFrame } from './shell/site-frame';

/**
 * The linked demos that have loaded. While the card is prerendered, a link
 * that has not been loaded yet is an empty slot in the list.
 */
function loadedDemos(demos: unknown[] | undefined): GalleryDemo[] {
  return (demos ?? []).filter((demo): demo is GalleryDemo => Boolean(demo));
}

/**
 * The whole gallery site, as one card.
 *
 * Gallery ⇄ demo is state inside this card rather than a navigation, so the
 * site frame's Choreo region sees each swap as one render pass and can fly
 * the tile into the page. Moving never touches the host's URL or title.
 */
class Isolated extends Component<typeof ChoreoGallery> {
  /** null is the gallery; a slug is that demo's page */
  @tracked private slug: string | null = null;
  readonly crossing = new Crossing();
  readonly theater = new Theater();
  /** counts moves, so a move waiting on a curtain knows it was superseded */
  private moves = 0;

  willDestroy() {
    super.willDestroy();
    this.crossing.reset();
  }

  get demos(): GalleryDemo[] {
    return loadedDemos(this.args.model.demos);
  }

  get current(): GalleryDemo | undefined {
    return this.slug === null
      ? undefined
      : this.demos.find((demo) => demo.slug === this.slug);
  }

  get near() {
    let index = this.demos.findIndex((demo) => demo.slug === this.slug);
    return { next: this.demos[index + 1], prev: this.demos[index - 1] };
  }

  get homeHref() {
    return this.args.model.id ?? '';
  }

  hrefFor = (slug: string | null) =>
    slug === null
      ? this.homeHref
      : (this.demos.find((demo) => demo.slug === slug)?.id ?? this.homeHref);

  go = (slug: string | null) => this.move(slug, false);

  goHome = () => this.go(null);

  openInTheater = (slug: string) => this.move(slug, true);

  /**
   * Move to a page, in theater or not. The mode goes to the swap rather than
   * being set after this returns, because the swap can wait a frame on the
   * leaving page's curtain.
   */
  private move(slug: string | null, theater: boolean) {
    this.moves++;
    if (slug === this.slug) {
      if (slug === null) {
        this.crossing.scrollToTop();
      }
      return;
    }
    // A film's page drops its curtain a frame ahead of the swap, so the
    // crossing flies the film's poster rather than a frame that reloads in
    // flight. A newer move supersedes the one waiting on the curtain.
    if (this.current?.theater && !this.theater.curtain && factor() !== 0) {
      this.theater.curtain = true;
      let move = this.moves;
      requestAnimationFrame(() => {
        if (move === this.moves) {
          this.cross(slug, theater);
        }
      });
      return;
    }
    this.cross(slug, theater);
  }

  /** the page swap itself, which the site frame's region animates */
  private cross(slug: string | null, theater: boolean) {
    this.crossing.begin(this.slug, slug);
    this.slug = slug;
    // theater belongs to the page it was entered on
    this.theater.reset(theater);
    // the clock is global, so it goes back to normal with every page — a
    // stage with no speed control must never be left mysteriously slow
    setMotionSpeed(1);
  }

  nav: GalleryNavigation = {
    go: this.go,
    hrefFor: this.hrefFor,
    openInTheater: this.openInTheater,
  };

  <template>
    <SiteFrame
      @crossing={{this.crossing}}
      @homeHref={{this.homeHref}}
      @goHome={{this.goHome}}
      @theater={{this.theater}}
    >
      {{#if this.current}}
        <DemoPage
          @demo={{this.current}}
          @nav={{this.nav}}
          @near={{this.near}}
          @theater={{this.theater}}
        />
      {{else}}
        <GalleryGrid
          @crossing={{this.crossing}}
          @demos={{this.demos}}
          @nav={{this.nav}}
        />
      {{/if}}
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
