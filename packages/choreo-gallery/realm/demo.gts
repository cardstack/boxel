import BooleanField from '@cardstack/base/boolean';
import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  FieldDef,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import TextAreaField from '@cardstack/base/text-area';
import type { Join } from '@cardstack/choreo/film';
import type { ComponentLike } from '@glint/template';

import type { FilmLink } from './lib/film-link';
import { Theater } from './lib/theater';
import { ChoreoRoot } from './shell/choreo-root';
import { DemoPage } from './shell/demo-page';
import { DemoStage } from './shell/demo-stage';

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
    /** opens the demo's page in theater, from a tile */
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
 * subject runs to the top of the frame. The default well suits a demo that
 * fills its width.
 */
export type StageWell = 'tall' | 'wide';

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

class Isolated extends Component<typeof GalleryDemo> {
  readonly theater = new Theater();

  get demo() {
    return this.args.model as GalleryDemo;
  }

  <template>
    <ChoreoRoot class='standalone'>
      <div class='page'>
        <DemoPage @demo={{this.demo}} @theater={{this.theater}} />
      </div>
    </ChoreoRoot>
    <style scoped>
      .standalone {
        min-height: 100%;
      }

      .page {
        width: min(var(--page), calc(100% - 48px));
        margin: 0 auto;
        padding: 40px 0 64px;
      }
    </style>
  </template>
}

class Embedded extends Component<typeof GalleryDemo> {
  get demo() {
    return this.args.model as GalleryDemo;
  }

  <template>
    <ChoreoRoot class='tile'>
      <div class='tile-stage'>
        <DemoStage @demo={{this.demo}} @face='tile' />
      </div>
      <div class='tile-meta'>
        <span class='tile-group'>{{@model.group}}</span>
        <span class='tile-title'>{{@model.title}}</span>
        <span class='tile-lede'>{{@model.lede}}</span>
      </div>
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
        color: var(--ember-hot);
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
    </style>
  </template>
}

class Fitted extends Component<typeof GalleryDemo> {
  <template>
    <ChoreoRoot class='fitted'>
      <span class='fitted-group'>{{@model.group}}</span>
      <span class='fitted-title'>{{@model.title}}</span>
    </ChoreoRoot>
    <style scoped>
      .fitted {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 4px;
        height: 100%;
        padding: 10px 12px;
        overflow: hidden;
      }

      .fitted-group {
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ember-hot);
      }

      .fitted-title {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 1rem;
        letter-spacing: -0.03em;
        line-height: 1.1;
        overflow: hidden;
        text-overflow: ellipsis;
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
