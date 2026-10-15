import BooleanField from '@cardstack/base/boolean';
import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  FieldDef,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import TextAreaField from '@cardstack/base/text-area';
import type { Join } from '@cardstack/choreo/film';
import { rri } from '@cardstack/runtime-common';
import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import type { ComponentLike } from '@glint/template';
import { modifier } from 'ember-modifier';

import type { ChoreoGallery } from './gallery';
import type { FilmLink } from './lib/film-link';
import { labSlug, LabState } from './lib/lab';
import { restWhenOff } from './lib/onstage';
import { openThroughHost, ownClicks, ownControlClicks } from './lib/pointer';
import { realmFile } from './lib/realm-url';
import { requestTheater, takeTheaterRequest, Theater } from './lib/theater';
import { ChoreoRoot } from './shell/choreo-root';
import { DemoPage } from './shell/demo-page';
import { DemoStage } from './shell/demo-stage';
import { GuideLink } from './shell/guide-link';
import { LabPanel } from './shell/lab-panel';
import { LabToggle } from './shell/lab-toggle';
import { SiteFrame } from './shell/site-frame';

/** the gallery's sections, in the order its filters list them */
export const GROUPS = [
  'Animate',
  'Layout',
  'Drag',
  'Scroll',
  'Choreo',
  '3D',
  /* FILM holds the pictures built on `<Film>`. They are 3D and Choreo and
     timeline work at once, and filing them under any one of those buries
     them — a film is its own kind of thing. */
  'Film',
  'Timeline',
] as const;

export type DemoGroup = (typeof GROUPS)[number];

/** what a demo's stage is told about where it is rendering */
export interface StageSignature {
  Args: {
    /** `tile` in the gallery grid and summaries; `stage` on the demo page */
    face?: 'stage' | 'tile';
    /** the demo page's line to its film, for a film stage to attach to */
    filmLink?: FilmLink;
    /** opens the demo card's page in theater, from a tile */
    open?: () => void;
    /** the demo page's theater, for a film stage to enter and leave */
    theater?: Theater;
  };
}

/** what a demo's notes are told: how to play a join over the stage's film */
export interface NotesSignature {
  Args: {
    /** set while a film is attached to the demo page's stage */
    preview?: (join: Join) => void;
  };
}

/**
 * The shape of the demo page's well, for a stage composed for a particular
 * frame: `wide` is a film composed about sixteen by nine, `tall` a film whose
 * subject runs to the top of the frame, `laptop` a wide, short device that
 * wants headroom above it and floor beneath, and `phone` a portrait device.
 * The default well suits a demo that fills its width.
 */
export type StageWell = 'laptop' | 'phone' | 'tall' | 'wide';

/** One step of a demo's walkthrough: a sentence of why, then the code. */
export class WalkthroughStep extends FieldDef {
  static displayName = 'Walkthrough Step';
  @field label = contains(StringField);
  @field note = contains(TextAreaField);
  @field source = contains(TextAreaField);
}

/**
 * What a demo teaches, reviewed against its source: the concept, why it
 * works, something to try, the trap, and what it combines with. `guide` names
 * the concept guide the demo belongs to.
 */
export class DemoLesson extends FieldDef {
  static displayName = 'Demo Lesson';
  @field guide = contains(StringField);
  @field concept = contains(StringField);
  @field why = contains(TextAreaField);
  @field experiment = contains(TextAreaField);
  @field pitfall = contains(TextAreaField);
  @field combine = contains(TextAreaField);
}

/** the neighbours of a demo in its gallery's catalog */
export interface Near {
  next?: GalleryDemo;
  prev?: GalleryDemo;
}

/**
 * The demo's page, wherever it opens: in a stack over the gallery, as a
 * published page of its own, or on its own in the host. It wears the site's
 * frame, and its pager opens the demos either side of it in the gallery's
 * order, through the host, as the gallery's tiles do.
 */
class Isolated extends Component<typeof GalleryDemo> {
  /** a film's page opens in theater when its tile asked for it */
  readonly theater = new Theater(
    takeTheaterRequest((this.args.model as GalleryDemo).slug),
  );

  get demo() {
    return this.args.model as GalleryDemo;
  }

  get near(): Near {
    let demos = (this.demo.gallery as ChoreoGallery | undefined)?.demos ?? [];
    let index = demos.findIndex((demo) => demo?.id === this.demo.id);
    if (index < 0) {
      return {};
    }
    return {
      next: demos[index + 1] ?? undefined,
      prev: index > 0 ? (demos[index - 1] ?? undefined) : undefined,
    };
  }

  get open() {
    let viewCard = this.args.viewCard;
    return viewCard
      ? (demo: GalleryDemo) => viewCard(demo, 'isolated')
      : undefined;
  }

  <template>
    <SiteFrame @theater={{this.theater}}>
      <DemoPage
        @demo={{this.demo}}
        @near={{this.near}}
        @onOpen={{this.open}}
        @theater={{this.theater}}
      />
    </SiteFrame>
  </template>
}

/**
 * The demo where a document embeds it, as a guide does: the live stage, what
 * it is, its guide, and the lab, opened under the stage.
 */
class Embedded extends Component<typeof GalleryDemo> {
  readonly lab = new LabState();

  get demo() {
    return this.args.model as GalleryDemo;
  }

  get labSlug(): string | undefined {
    return labSlug(this.demo);
  }

  get labOpen(): boolean {
    return this.lab.isOpen(this.labSlug);
  }

  toggleLab = () => this.lab.toggle(this.labSlug);

  <template>
    <ChoreoRoot class='tile'>
      <div class='tile-stage' {{ownClicks}}>
        {{#each (array this.lab.replays) key='@identity'}}
          <DemoStage @demo={{this.demo}} @face='tile' />
        {{/each}}
      </div>
      <div class='tile-meta'>
        <span class='tile-group'>{{@model.group}}</span>
        <span class='tile-title'>{{@model.title}}</span>
        <span class='tile-lede'>{{@model.lede}}</span>
        <span class='tile-links' {{ownClicks}}>
          {{#if this.labSlug}}
            <LabToggle @open={{this.labOpen}} @onToggle={{this.toggleLab}} />
          {{/if}}
          <GuideLink @demo={{this.demo}} />
        </span>
      </div>
      {{#if this.labOpen}}
        {{#if this.labSlug}}
          <div class='tile-lab' {{ownClicks}}>
            <LabPanel
              @slug={{this.labSlug}}
              @title={{@model.title}}
              @onReplay={{this.lab.replay}}
            />
          </div>
        {{/if}}
      {{/if}}
    </ChoreoRoot>
    <style scoped>
      .tile {
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--bg-elev);
      }

      .tile-stage {
        position: relative;
        height: 360px;
        container-name: platter;
        container-type: size;
        background: var(--bg);
      }

      .tile-meta {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 16px 18px 18px;
        border-top: 1px solid var(--line);
      }

      .tile-group {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--eyebrow);
      }

      .tile-title {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 1.2rem;
        letter-spacing: -0.03em;
      }

      .tile-lede {
        color: var(--ink-dim);
        font-size: 0.92rem;
      }

      .tile-links {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 8px 20px;
        margin-top: 4px;
      }

      .tile-lab {
        padding: 16px 18px 18px;
        border-top: 1px solid var(--line);
      }
    </style>
  </template>
}

/** the smallest box a tile boots its live stage in */
const STAGE_ROOM = { height: 300, width: 240 };

/**
 * The demo as a tile: the live stage over what it is, with its guide. It is
 * the gallery's grid, and the host opens the demo card on a click anywhere on
 * it that the stage does not keep for itself.
 *
 * Each tile is a live demo, and a grid holds dozens, so a tile spends only
 * what it shows: its stage boots once the tile has room for it, rests while
 * it is scrolled out of view, and a film shows its poster rather than
 * running. In a box too small for a stage, as the host's lists and pickers
 * draw it, the tile is just the demo's name.
 */
class Fitted extends Component<typeof GalleryDemo> {
  @tracked roomy = false;

  get demo() {
    return this.args.model as GalleryDemo;
  }

  get deepDive(): boolean {
    return Boolean((this.demo.constructor as typeof GalleryDemo).notes);
  }

  measure = modifier((element: HTMLElement) => {
    let observer = new ResizeObserver(([entry]) => {
      let { height, width } = entry!.contentRect;
      // No box at all is not a small box: the host hides a covered stack
      // item's content with `display: none`. The stage stays mounted, resting
      // (see `restWhenOff`), and carries on from where it was when the card
      // shows again, rather than starting over.
      if (height === 0 && width === 0) {
        return;
      }
      let roomy = height >= STAGE_ROOM.height && width >= STAGE_ROOM.width;
      if (roomy !== this.roomy) {
        this.roomy = roomy;
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

  /** a film's door: its page, opened straight into theater */
  get open() {
    let viewCard = this.args.viewCard;
    let slug = this.demo.slug;
    if (!viewCard || !slug) {
      return undefined;
    }
    return () => {
      requestTheater(slug);
      viewCard(this.demo, 'isolated');
    };
  }

  <template>
    <ChoreoRoot class='tile {{if this.roomy "is-roomy"}}' {{this.measure}}>
      {{#if this.roomy}}
        <div class='tile-stage' {{restWhenOff}} {{ownControlClicks}}>
          <DemoStage @demo={{this.demo}} @face='tile' @open={{this.open}} />
        </div>
      {{/if}}
      <div class='tile-meta'>
        <span class='tile-group'>
          {{@model.group}}
          {{#if this.deepDive}}
            <span class='tile-badge'>Deep Dive</span>
          {{/if}}
        </span>
        {{! the tile's one link, to the demo card: its name, and the way in for
          a keyboard, whose Enter the host takes as it takes a click }}
        <a
          class='tile-title'
          href={{@model.id}}
          {{on 'click' openThroughHost}}
        >{{@model.title}}</a>
        {{#if this.roomy}}
          <span class='tile-lede'>{{@model.lede}}</span>
          <span class='tile-links' {{ownClicks}}>
            <GuideLink @demo={{this.demo}} />
          </span>
        {{/if}}
      </div>
    </ChoreoRoot>
    <style scoped>
      .tile {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        height: 100%;
        overflow: hidden;
        background:
          linear-gradient(
            180deg,
            rgba(var(--surface-tint-rgb), 0.02),
            transparent 40%
          ),
          var(--bg-elev);
      }

      /* a NAMED size container, so a stage can ask about the platter
         specifically rather than whichever container is nearest */
      .tile-stage {
        position: relative;
        flex: 1;
        min-height: 0;
        container-name: platter;
        container-type: size;
        background:
          radial-gradient(
            80% 70% at 50% 40%,
            rgba(255, 59, 31, 0.08),
            transparent 62%
          ),
          var(--bg);
      }

      /* A tile nobody can see holds its animations where they stand —
         paused, so coming back does not restart every loop */
      .tile-stage.is-resting,
      .tile-stage.is-resting :deep(*) {
        animation-play-state: paused !important;
      }

      .tile-meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 12px;
        overflow: hidden;
      }

      .tile.is-roomy .tile-meta {
        gap: 6px;
        padding: 16px 18px 16px;
        border-top: 1px solid var(--line);
        background: rgba(var(--surface-tint-rgb), 0.015);
      }

      .tile-group {
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--eyebrow);
      }

      .tile.is-roomy .tile-group {
        font-size: 10px;
      }

      .tile-badge {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 6px;
        font-size: 9px;
        font-family: var(--font-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ember-ink);
        border: 1px solid color-mix(in srgb, var(--ember-ink) 55%, transparent);
        border-radius: 3px;
        vertical-align: middle;
      }

      .tile-title {
        color: inherit;
        text-decoration: none;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 1rem;
        letter-spacing: -0.03em;
        line-height: 1.1;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tile.is-roomy .tile-title {
        font-size: 1.2rem;
      }

      @media (hover: hover) {
        .tile:hover .tile-title {
          color: var(--ember-ink);
        }
      }

      /* the link is the tile's focus, and the whole tile wears the ring: the
         tile clips what falls outside it, so the ring is drawn inside */
      .tile-title:focus-visible {
        outline: none;
      }

      .tile:has(.tile-title:focus-visible) {
        outline: 2px solid var(--focus-ring);
        outline-offset: -2px;
      }

      .tile-lede {
        color: var(--ink-dim);
        font-size: 0.92rem;
      }

      .tile-links {
        margin-top: 4px;
      }
    </style>
  </template>
}

/**
 * One entry in the gallery: its words and its code are this card's data; its
 * live stage and its long-form notes are components, supplied by a subclass
 * per demo as the class's `stage` and `notes`.
 */
export class GalleryDemo extends CardDef {
  static displayName = 'Choreo Demo';
  static prefersWideFormat = true;

  /** the live demo; undefined until the demo has a stage of its own */
  static stage: ComponentLike<StageSignature> | undefined;
  /** the shape of the demo page's well, when the stage needs its own */
  static well: StageWell | undefined;
  /** how the demo works, rendered under the usage example (a Deep Dive) */
  static notes: ComponentLike<NotesSignature> | undefined;

  /** the demo's id in the catalog, and the instance's filename */
  @field slug = contains(StringField);
  @field title = contains(StringField);
  /** one of GROUPS */
  @field group = contains(StringField);
  @field lede = contains(StringField);
  /** the API names the demo exercises, as the page's pills */
  @field apis = containsMany(StringField);
  /** the usage example under the stage */
  @field sample = contains(TextAreaField);
  /**
   * Whether the stage honours `setMotionSpeed`, and so gets the speed
   * control. Motion driven by the pointer, the scroll position or an
   * imperative `animate()` call has no transition to scale, so those opt out.
   */
  @field slowmo = contains(BooleanField);
  /** whether the stage has a theater to enter: the films and Sylva's world */
  @field theater = contains(BooleanField);
  /** the data that drives the demo, quoted under the usage example */
  @field walkthrough = containsMany(WalkthroughStep);
  @field lesson = contains(DemoLesson);

  /** the gallery that lists this demo, whose order the demo page pages in */
  @field gallery = linksTo(CardDef, {
    query: {
      filter: {
        on: { module: rri(realmFile('gallery')), name: 'ChoreoGallery' },
        eq: { 'demos.id': '$this.id' },
      },
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: GalleryDemo) {
      return this.title;
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: GalleryDemo) {
      return this.lede;
    },
  });

  static isolated = Isolated;
  static embedded = Embedded;
  static fitted = Fitted;
}
