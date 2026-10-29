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
import { MotionConfig } from 'glimmer-motion';

import type { ChoreoGallery } from './gallery';
import type { FilmLink } from './lib/film-link';
import { pointerOnly } from './lib/focus';
import { labSlug, LabState } from './lib/lab';
import { MotionHold } from './lib/motion-hold';
import { openThroughHost, ownClicks, ownControlClicks } from './lib/pointer';
import { realmFile } from './lib/realm-url';
import { requestTheater, takeTheaterRequest, Theater } from './lib/theater';
import { ChoreoRoot } from './shell/choreo-root';
import { DemoPage } from './shell/demo-page';
import { DemoStage } from './shell/demo-stage';
import { GuideLink } from './shell/guide-link';
import { HeldStage } from './shell/held-stage';
import { LabPanel } from './shell/lab-panel';
import { LabToggle } from './shell/lab-toggle';
import { MotionToggle } from './shell/motion-toggle';
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
  readonly hold = new MotionHold();

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

  /** a replay, or a change of motion policy, mounts the stage afresh */
  get take(): string {
    return `${this.lab.replays}:${this.hold.reducedMotion}`;
  }

  <template>
    <ChoreoRoot class='tile' data-test-demo-tile>
      <HeldStage
        class='tile-stage'
        @hold={{this.hold}}
        {{ownClicks}}
        data-test-tile-stage
      >
        {{#each (array this.take) key='@identity'}}
          <MotionConfig @reducedMotion={{this.hold.reducedMotion}}>
            <DemoStage @demo={{this.demo}} @face='tile' />
          </MotionConfig>
        {{/each}}
      </HeldStage>
      <div class='tile-meta'>
        <span class='tile-group'>{{@model.group}}</span>
        <span class='tile-title' data-test-tile-title>{{@model.title}}</span>
        <span class='tile-lede'>{{@model.lede}}</span>
        <span class='tile-links' {{ownClicks}}>
          <MotionToggle @hold={{this.hold}} />
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
        background: var(--card);
      }

      .tile-stage {
        position: relative;
        height: 360px;
        container-name: platter;
        container-type: size;
        background: var(--canvas);
      }

      .tile-meta {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 16px 18px 18px;
        border-top: 1px solid var(--border);
      }

      .tile-group {
        font-family: var(--boxel-eyebrow-font-family);
        font-weight: var(--boxel-eyebrow-font-weight);
        font-size: calc(var(--boxel-eyebrow-font-size) * 10 / 11);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: calc(var(--boxel-eyebrow-letter-spacing) * 16 / 18);
        text-transform: uppercase;
        color: var(--primary-ink);
      }

      .tile-title {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 1.2rem;
        letter-spacing: -0.03em;
      }

      .tile-lede {
        color: var(--muted-foreground);
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
        border-top: 1px solid var(--border);
      }
    </style>
  </template>
}

/** the smallest box a tile boots its live stage in */
const STAGE_ROOM = { height: 300, width: 240 };

/**
 * The shortest tiles that hold the demo's group over a name of two lines, and
 * over a name of one: the host's strips and badges are 105, 65 and 40px tall.
 */
const TWO_LINE_ROOM = 76;
const GROUP_ROOM = 58;

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
  /** how much of the name and group a tile too short for a stage can show */
  @tracked fit: 'is-short' | 'is-tiny' | undefined;
  /** a tile moves only once the viewer reaches into it: see MotionHold */
  readonly hold = new MotionHold();

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
      let fit: Fitted['fit'] =
        height < GROUP_ROOM
          ? 'is-tiny'
          : height < TWO_LINE_ROOM
            ? 'is-short'
            : undefined;
      if (fit !== this.fit) {
        this.fit = fit;
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
    <ChoreoRoot
      class='tile {{if this.roomy "is-roomy"}} {{this.fit}}'
      {{this.measure}}
      data-test-demo-tile
    >
      {{#if this.roomy}}
        {{! the stage is the pointer's: the keyboard and a screen reader go
          from the title link to the guide link, and use the stage on the
          demo's page }}
        <HeldStage
          class='tile-stage'
          @hold={{this.hold}}
          {{ownControlClicks}}
          {{pointerOnly}}
          data-test-tile-stage
        >
          <DemoStage @demo={{this.demo}} @face='tile' @open={{this.open}} />
        </HeldStage>
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
          data-test-tile-title
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
            color-mix(in srgb, var(--surface-tint) 2%, transparent),
            transparent 40%
          ),
          var(--card);
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
            color-mix(in srgb, var(--primary) 8%, transparent),
            transparent 62%
          ),
          var(--canvas);
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
        border-top: 1px solid var(--border);
        background: color-mix(in srgb, var(--surface-tint) 1.5%, transparent);
      }

      .tile-group {
        font-family: var(--boxel-eyebrow-font-family);
        font-weight: var(--boxel-eyebrow-font-weight);
        font-size: calc(var(--boxel-eyebrow-font-size) * 9 / 11);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: calc(var(--boxel-eyebrow-letter-spacing) * 16 / 18);
        text-transform: uppercase;
        color: var(--primary-ink);
      }

      .tile.is-roomy .tile-group {
        font-size: calc(var(--boxel-eyebrow-font-size) * 10 / 11);
        line-height: var(--boxel-eyebrow-line-height);
      }

      .tile-badge {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 6px;
        font-size: 9px;
        font-family: var(--font-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--primary-ink);
        border: 1px solid
          color-mix(in srgb, var(--primary-ink) 55%, transparent);
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
        /* a long name gets two lines and an ellipsis, not a cut through a
           letter wherever the tile happens to end; and its lines are never
           squeezed, so a tile shorter than them clips whole lines */
        flex-shrink: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        overflow-wrap: break-word;
      }

      .tile.is-roomy .tile-title {
        font-size: 1.2rem;
      }

      /* a strip or a badge: the name on one line, and in the shortest of
         them without its group, rather than either cut through */
      .tile.is-short .tile-title,
      .tile.is-tiny .tile-title {
        -webkit-line-clamp: 1;
        line-clamp: 1;
      }

      .tile.is-tiny .tile-group {
        display: none;
      }

      @media (hover: hover) {
        .tile:hover .tile-title {
          color: var(--primary-ink);
        }
      }

      /* the link is the tile's focus, and the whole tile wears the ring: the
         tile clips what falls outside it, so the ring is drawn inside */
      .tile-title:focus-visible {
        outline: none;
      }

      .tile:has(.tile-title:focus-visible) {
        outline: 2px solid var(--ring);
        outline-offset: -2px;
        /* rounded as the box that clips it, so the ring's corners show */
        border-radius: var(--tile-radius, 0);
      }

      .tile-lede {
        color: var(--muted-foreground);
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
