import { service } from '@ember/service';
import Component from '@glimmer/component';

import { AgentQuestion } from '@cardstack/pretui/components/agent-question';
import { Recommendation } from '@cardstack/pretui/components/recommendation';
import { resource, use } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';

import { eq } from '@cardstack/boxel-ui/helpers';

import { isCardInstance } from '@cardstack/runtime-common';

import CardRenderer from '../card-renderer';

import type StoreService from '../../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type { AgentChoice } from '@cardstack/pretui/components/agent-question';
import type { RecommendationOption } from '@cardstack/pretui/components/recommendation';

export interface AskUserOptionData {
  label?: string;
  value?: string;
  detail?: string;
  cardId?: string;
  color?: string;
  // for kind 'recommend': how sure the assistant is, 'high' | 'medium' |
  // 'low' (or 0–3)
  confidence?: string | number;
}

// A confidence as Recommendation's meter level and word.
function confidenceOf(value: string | number | undefined, best: boolean) {
  let word =
    typeof value === 'number'
      ? (['low', 'low', 'medium', 'high'][Math.max(0, Math.min(3, value))] ??
        'medium')
      : (value?.trim() || (best ? 'high' : 'medium')).toLowerCase();
  let level = word === 'high' ? 3 : word === 'low' ? 1 : 2;
  return {
    level,
    label: `${word[0]!.toUpperCase()}${word.slice(1)} confidence`,
  };
}

interface Signature {
  Element: HTMLDivElement;
  Args: {
    question?: string;
    kind?: string;
    options: AskUserOptionData[];
    allowOther?: boolean;
    disabled?: boolean;
    onAnswer: (answer: string) => void;
  };
}

function optionValue(option: AskUserOptionData): string {
  return option.value ?? option.label ?? option.cardId ?? option.color ?? '';
}

// One option shown as its card: the live card, fitted, loaded from the store
// and held while it is on screen.
class OptionCard extends Component<{
  Args: { cardId: string };
}> {
  @service declare private store: StoreService;

  @use private loaded = resource(({ on }) => {
    let state = new TrackedObject<{ card?: CardDef }>({});
    let id = this.args.cardId;
    let torn = false;
    this.store.addReference(id);
    on.cleanup(() => {
      torn = true;
      this.store.dropReference(id);
    });
    this.store.get(id).then((value) => {
      if (!torn && isCardInstance(value)) {
        state.card = value as CardDef;
      }
    });
    return state;
  });

  <template>
    {{#if this.loaded.card}}
      <CardRenderer
        class='option-card-render'
        @card={{this.loaded.card}}
        @format='fitted'
        @displayContainer={{false}}
      />
    {{else}}
      <span class='option-card-loading'>Loading…</span>
    {{/if}}
    <style scoped>
      .option-card-render {
        width: 100%;
        height: 100%;
      }
      .option-card-loading {
        display: grid;
        place-items: center;
        height: 100%;
        font: var(--boxel-font-xs);
        color: var(--boxel-450);
      }
    </style>
  </template>
}

// The assistant's question as Pret UI's AgentQuestion, answered in its row.
// Cards show the live card each option stands for; swatches show the color.
// Both are picked, then confirmed, so a stray tap does not answer. Plain
// options answer at once. "Something else…" takes a typed answer when the
// assistant allows it.
export default class AskUserPicker extends Component<Signature> {
  private get kind() {
    let kind = this.args.kind;
    if (kind === 'cards' || kind === 'swatches') {
      return kind;
    }
    // a question whose every option is a color is a color question,
    // however the model phrased it ("value: '#c3fc33'", no kind, or a
    // recommendation): the colors show, not their names
    let options = this.args.options;
    if (options.length && options.every((option) => colorOf(option))) {
      return 'swatches';
    }
    return kind === 'recommend' ? kind : 'options';
  }

  // kind 'recommend': the assistant's pick first, the others behind
  // Alternatives, each with how sure it is (Pret UI's Recommendation)
  private get recommendations(): RecommendationOption[] {
    return this.args.options.map((option, index) => {
      let label = option.label ?? optionValue(option);
      return {
        key: optionValue(option),
        short: label,
        body: option.detail ? `${label}. ${option.detail}` : label,
        ...confidenceOf(option.confidence, index === 0),
        cta: `Go with ${label}`,
      };
    });
  }

  private acceptRecommendation = (option: RecommendationOption) => {
    this.args.onAnswer(option.key);
  };

  private get layout(): 'cards' | 'swatches' {
    return this.kind === 'swatches' ? 'swatches' : 'cards';
  }

  private get choices(): (AgentChoice & { cardId?: string })[] | undefined {
    if (this.kind === 'options' || this.kind === 'recommend') {
      return undefined;
    }
    let swatches = this.kind === 'swatches';
    return this.args.options.map((option) => {
      let label = option.label ?? option.color ?? optionValue(option);
      return {
        // the tile draws the color, so a label's own color mark goes
        label: swatches ? swatchName(label) : label,
        value: optionValue(option),
        sub: swatches ? withoutColor(option.detail, label) : option.detail,
        swatch: swatches ? colorOf(option) : undefined,
        cardId: option.cardId,
      };
    });
  }

  // plain options as the kit's pills: their labels, mapped back to values
  private get optionLabels(): string[] | undefined {
    return this.kind === 'options'
      ? this.args.options.map((option) => option.label ?? optionValue(option))
      : undefined;
  }

  private answer = (answer: string) => {
    let option =
      this.kind === 'options'
        ? this.args.options.find(
            (candidate) =>
              (candidate.label ?? optionValue(candidate)) === answer,
          )
        : undefined;
    this.args.onAnswer(option ? optionValue(option) : answer);
  };

  private cardIdOf = (choice: AgentChoice) =>
    (choice as AgentChoice & { cardId?: string }).cardId;

  <template>
    {{#if (eq this.kind 'recommend')}}
      <Recommendation
        class='ask-user-picker'
        @question={{if @question @question ''}}
        @options={{this.recommendations}}
        @onAccept={{this.acceptRecommendation}}
        @surface='plain'
        data-kind='recommend'
        data-test-ask-user
      />
    {{else if (eq this.kind 'cards')}}
      {{! only cards fill a choice's preview: any other kind passes no
          block, or every tile keeps the preview's empty height }}
      <AgentQuestion
        class='ask-user-picker'
        @question={{if @question @question ''}}
        @options={{this.optionLabels}}
        @choices={{this.choices}}
        @layout={{this.layout}}
        @confirm={{if this.choices true false}}
        @freeAnswer={{if @allowOther true false}}
        @otherLabel='Something else…'
        @pending={{@disabled}}
        @onAnswer={{this.answer}}
        data-kind={{this.kind}}
        data-test-ask-user
      >
        <:choice as |choice|>
          {{#let (this.cardIdOf choice) as |cardId|}}
            {{#if cardId}}
              <span class='option-card-frame' data-theme='light'>
                <OptionCard @cardId={{cardId}} />
              </span>
            {{/if}}
          {{/let}}
        </:choice>
      </AgentQuestion>
    {{else}}
      <AgentQuestion
        class='ask-user-picker'
        @question={{if @question @question ''}}
        @options={{this.optionLabels}}
        @choices={{this.choices}}
        @layout={{this.layout}}
        @confirm={{if this.choices true false}}
        @freeAnswer={{if @allowOther true false}}
        @otherLabel='Something else…'
        @pending={{@disabled}}
        @onAnswer={{this.answer}}
        data-kind={{this.kind}}
        data-test-ask-user
      />
    {{/if}}
    <style scoped>
      .option-card-frame {
        display: block;
        height: 100%;
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
      }
      /* the choice's box is the one rounded shape and clips to it: the card
         meets its edges square, or the frame's white shows in each corner */
      .option-card-frame :deep(.boxel-card-container),
      .option-card-frame :deep(.field-component-card) {
        height: 100%;
        border-radius: 0;
        box-shadow: none;
      }
    </style>
  </template>
}

// emoji and symbols a model puts before a color's name ("🟩 Fresh lime")
const LEADING_MARKS = /^[\p{Extended_Pictographic}\p{So}\uFE0F\s]+/u;
// a color written out: hex or a color function, never a bare word, which
// could be any answer
const WRITTEN_COLOR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab)\([^)]*\))$/i;
// a hex written into an option's label
const HEX_IN_LABEL = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i;
// the color the swatch already shows, written into a detail
const HEX_PART = /\s*[·•|:,–-]?\s*#[0-9a-f]{3,8}\s*[·•|:,–-]?\s*/gi;

// An option's color: its color, or a value written as a color.
function colorOf(option: AskUserOptionData): string | undefined {
  let value = option.value?.trim();
  return (
    safeColor(option.color) ??
    (value && WRITTEN_COLOR.test(value) ? value : undefined) ??
    HEX_IN_LABEL.exec(option.label ?? '')?.[0]
  );
}

// A color's name as the tile shows it: no color mark before it and no hex
// after it ("🟠 Amber — #D97706" is Amber)
function swatchName(label: string): string {
  return (
    label
      .replace(LEADING_MARKS, '')
      .replace(HEX_PART, ' ')
      .replace(/\s*[—–-]\s*$/, '')
      .trim() || label
  );
}

// A swatch's detail, less what the tile already says: its hex, and its name
// over again ("Lime green · #c3fc33" under "Lime" says nothing more)
function withoutColor(
  detail: string | undefined,
  label: string,
): string | undefined {
  let rest = detail?.replace(HEX_PART, ' ').trim();
  if (!rest) {
    return undefined;
  }
  let name = label.replace(LEADING_MARKS, '').trim().toLowerCase();
  return rest.toLowerCase().includes(name) ? undefined : rest;
}

// A swatch's color: a CSS color value only, so a stray string cannot
// become arbitrary style.
function safeColor(color: string | undefined): string | undefined {
  let value = typeof color === 'string' ? color.trim() : '';
  return /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(
    value,
  )
    ? value
    : undefined;
}
