import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';

import {
  CardDef,
  Component,
  FieldDef,
  contains,
  field,
  primitive,
  StringField,
  type EditCardFn,
  type FieldsTypeFor,
  type Format,
} from 'https://cardstack.com/base/card-api';
import { Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import SparklesIcon from '@cardstack/boxel-icons/sparkles';

// Used by both `static embedded` and `static edit` so the field component
// instance is preserved when the parent card flips between formats. The
// emoji button gets a CSS transition when classes change.
const VIBES = ['🌊', '🚀', '🌸', '🔥', '🌙', '⚡', '🎯', '🌈'] as const;

class VibeTemplate extends GlimmerComponent<{
  Element: HTMLButtonElement;
  Args: {
    model: string | undefined;
    set: (value: string) => void;
    format: Format;
    canEdit?: boolean;
  };
}> {
  get currentVibe() {
    return this.args.model ?? VIBES[0];
  }

  cycle = () => {
    if (this.args.format !== 'edit' || !this.args.canEdit) {
      return;
    }
    let i = VIBES.indexOf(this.currentVibe as (typeof VIBES)[number]);
    let next = VIBES[(i + 1) % VIBES.length];
    this.args.set(next);
  };

  <template>
    <button
      type='button'
      class='vibe vibe--{{@format}}'
      title={{if (eq @format 'edit') 'Click to cycle vibe' 'Vibe'}}
      disabled={{eq @format 'embedded'}}
      data-test-vibe-format={{@format}}
      {{on 'click' this.cycle}}
      ...attributes
    >
      <span class='vibe__emoji'>{{this.currentVibe}}</span>
      {{#if (eq @format 'edit')}}
        <span class='vibe__hint'>tap to change</span>
      {{/if}}
    </button>
    <style scoped>
      .vibe {
        all: unset;
        cursor: pointer;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--vibe-gap, 6px);
        padding: var(--vibe-pad, 16px);
        border-radius: var(--vibe-radius, 999px);
        background: var(--vibe-bg, transparent);
        line-height: 1;
        transition:
          gap 360ms cubic-bezier(0.2, 0.7, 0, 1),
          padding 360ms cubic-bezier(0.2, 0.7, 0, 1),
          background 360ms cubic-bezier(0.2, 0.7, 0, 1),
          border-radius 360ms cubic-bezier(0.2, 0.7, 0, 1),
          transform 360ms cubic-bezier(0.2, 0.7, 0, 1);
      }
      .vibe:hover {
        transform: scale(1.05);
      }
      .vibe[disabled] {
        cursor: default;
      }
      .vibe[disabled]:hover {
        transform: none;
      }
      .vibe__emoji {
        font-size: var(--vibe-emoji-size, 96px);
        transition: font-size 360ms cubic-bezier(0.2, 0.7, 0, 1);
      }
      .vibe__hint {
        font: 600 11px/1 ui-sans-serif, system-ui, sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(0, 0, 0, 0.55);
      }

      .vibe--isolated {
        --vibe-pad: 32px;
        --vibe-gap: 8px;
        --vibe-bg: linear-gradient(135deg, #fef3c7, #fde68a);
        --vibe-radius: 28px;
        --vibe-emoji-size: 112px;
      }
      .vibe--edit {
        --vibe-pad: 14px;
        --vibe-gap: 4px;
        --vibe-bg: rgba(0, 0, 0, 0.04);
        --vibe-radius: 14px;
        --vibe-emoji-size: 48px;
      }
      .vibe--embedded,
      .vibe--atom {
        --vibe-pad: 0;
        --vibe-emoji-size: 32px;
      }
    </style>
  </template>
}

export class Vibe extends FieldDef {
  static displayName = 'Vibe';
  static icon = SparklesIcon;
  static [primitive]: string;

  // Same component reference for both view and edit slots: lookupComponents
  // detects the identity and resolves both formats to the shared reference,
  // so toggling parent format keeps this field's DOM and component state
  // mounted. The CSS transitions on .vibe-- classes are visible because of
  // that — without the identity guarantee the element would be torn down
  // and re-created with the new class, snapping instead of animating.
  static embedded = VibeTemplate;
  static edit = VibeTemplate;

  static atom = class Atom extends Component<typeof this> {
    <template>{{@model}}</template>
  };
}

class FormatMorphTemplate extends GlimmerComponent<{
  Args: {
    model: FormatMorph;
    fields: FieldsTypeFor<FormatMorph>;
    format: Format;
    editCard?: EditCardFn;
  };
}> {
  enterEdit = () => {
    if (this.args.model.id) {
      this.args.editCard?.(this.args.model);
    }
  };

  <template>
    <article
      class='morph morph--{{@format}}'
      data-test-format-morph={{@format}}
    >
      <header class='morph__head'>
        <div class='morph__title-block'>
          <h1 class='morph__title'><@fields.title /></h1>
          <p class='morph__tagline'><@fields.tagline /></p>
        </div>
        <@fields.vibe class='morph__vibe' />
      </header>

      <section class='morph__body'>
        <@fields.body />
      </section>

      {{#if (eq @format 'isolated')}}
        <footer class='morph__footer'>
          <Button {{on 'click' this.enterEdit}} data-test-enter-edit>
            Edit
          </Button>
          <span class='morph__hint'>
            Component stays mounted — watch the layout morph instead of
            remount.
          </span>
        </footer>
      {{/if}}
    </article>

    <style scoped>
      .morph {
        --morph-bg: linear-gradient(160deg, #fdf4ff 0%, #fef3c7 100%);
        --morph-pad: 56px;
        --morph-gap: 32px;
        --morph-radius: 24px;
        --morph-title-size: 56px;
        --morph-tagline-size: 22px;
        --morph-tagline-style: italic;
        --morph-body-size: 18px;
        --morph-head-template: 1fr auto;
        --morph-shadow: 0 30px 60px -20px rgba(212, 100, 200, 0.25);
        display: grid;
        gap: var(--morph-gap);
        padding: var(--morph-pad);
        background: var(--morph-bg);
        border-radius: var(--morph-radius);
        box-shadow: var(--morph-shadow);
        max-width: 720px;
        margin: 32px auto;
        transition:
          gap 360ms cubic-bezier(0.2, 0.7, 0, 1),
          padding 360ms cubic-bezier(0.2, 0.7, 0, 1),
          background 360ms cubic-bezier(0.2, 0.7, 0, 1),
          border-radius 360ms cubic-bezier(0.2, 0.7, 0, 1),
          box-shadow 360ms cubic-bezier(0.2, 0.7, 0, 1);
      }
      .morph__head {
        display: grid;
        grid-template-columns: var(--morph-head-template);
        align-items: center;
        gap: var(--morph-gap);
        transition: gap 360ms cubic-bezier(0.2, 0.7, 0, 1);
      }
      .morph__title-block {
        display: grid;
        gap: 8px;
      }
      .morph__title {
        font: 700 var(--morph-title-size) / 1.05 'Iowan Old Style', Georgia,
          serif;
        margin: 0;
        transition: font-size 360ms cubic-bezier(0.2, 0.7, 0, 1);
      }
      .morph__tagline {
        font-size: var(--morph-tagline-size);
        font-style: var(--morph-tagline-style);
        color: rgba(0, 0, 0, 0.62);
        margin: 0;
        transition:
          font-size 360ms cubic-bezier(0.2, 0.7, 0, 1),
          font-style 360ms;
      }
      .morph__body {
        font-size: var(--morph-body-size);
        line-height: 1.55;
        transition: font-size 360ms cubic-bezier(0.2, 0.7, 0, 1);
      }
      .morph__footer {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .morph__hint {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.55);
      }

      .morph--edit {
        --morph-bg: #f8fafc;
        --morph-pad: 24px;
        --morph-gap: 16px;
        --morph-radius: 12px;
        --morph-title-size: 22px;
        --morph-tagline-size: 14px;
        --morph-tagline-style: normal;
        --morph-body-size: 14px;
        --morph-head-template: auto 1fr;
        --morph-shadow: 0 6px 18px -8px rgba(0, 0, 0, 0.18);
      }
      .morph--edit .morph__head {
        align-items: start;
      }

      .morph--embedded {
        --morph-pad: 20px;
        --morph-gap: 12px;
        --morph-title-size: 20px;
        --morph-tagline-size: 13px;
        --morph-body-size: 13px;
        --morph-shadow: none;
      }
    </style>
  </template>
}

export class FormatMorph extends CardDef {
  static displayName = 'Format Morph';
  static icon = SparklesIcon;
  static prefersWideFormat = false;

  @field title = contains(StringField);
  @field tagline = contains(StringField);
  @field body = contains(StringField);
  @field vibe = contains(Vibe);

  // Reference-equal isolated and edit slots: the new identity short-circuit
  // in `lookupComponents` resolves both formats to this single component,
  // so toggling the pencil keeps the same component instance mounted. The
  // CSS transitions on `.morph--isolated` ↔ `.morph--edit` are visible
  // *because* the component does not remount.
  static isolated = FormatMorphTemplate;
  static edit = FormatMorphTemplate;
}
