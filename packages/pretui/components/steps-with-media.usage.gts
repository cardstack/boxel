// Pretui — StepsWithMedia usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import type { StepItem, StepListVariant } from './step-list';
import type { MediaAssetSpec } from '../internal/media-viewer';
import { platePoster } from '../media-examples';
import { StepsWithMedia } from './steps-with-media';

// ── Fixtures ─────────────────────────────────────────────────────────────
const STEPS_ASSET: MediaAssetSpec = {
  src: platePoster('Lot workspace', '16 / 9'),
  name: 'Lot workspace',
  mimeType: 'image/svg+xml',
  kind: 'image',
  alt: 'A generated stand-in screenshot of the lot workspace',
  width: 1600,
  height: 900,
};

const HOW_STEPS: readonly StepItem[] = [
  {
    label: 'Open a lot',
    detail: 'Every lot arrives with its origin, grade and moisture already read.',
  },
  {
    label: 'Set your ceiling',
    detail: 'One number. The floor bids against it for you.',
  },
  {
    label: 'Watch the board',
    detail: 'Live positions, with your ceiling marked on every line.',
  },
  {
    label: 'Settle',
    detail: 'Contract, invoice and manifest are generated from the winning bid.',
  },
];

// ═════════════════════════════════════════════════════════════════════════
// ReadinessPanel
// ═════════════════════════════════════════════════════════════════════════

class StepsWithMediaUsage extends Component {
  @tracked eyebrow = 'How the floor works';
  @tracked title = 'Four steps from sample to settlement';
  @tracked lead =
    'The same four steps every lot goes through, whether it is a single chest or a whole season.';
  @tracked current = 2;
  @tracked variant = 'steps';
  @tracked summary = true;
  @tracked mediaSide = 'start';

  setEyebrow = (v: string) => (this.eyebrow = v);
  setTitle = (v: string) => (this.title = v);
  setLead = (v: string) => (this.lead = v);
  setCurrent = (v: number) => (this.current = v);
  setVariant = (v: string) => (this.variant = v);
  setSummary = (v: boolean) => (this.summary = v);
  setMediaSide = (v: string) => (this.mediaSide = v);

  get variantOptions(): string[] {
    return ['steps', 'track'];
  }
  get sideOptions(): string[] {
    return ['start', 'end'];
  }
  get railVariant(): StepListVariant {
    return this.variant === 'track' ? 'track' : 'steps';
  }
  get side(): 'start' | 'end' {
    return this.mediaSide === 'end' ? 'end' : 'start';
  }
  get steps(): StepItem[] {
    return [...HOW_STEPS];
  }
  get asset(): MediaAssetSpec {
    return STEPS_ASSET;
  }

  get usage(): string {
    return (
      '<StepsWithMedia\n' +
      "  @title='" +
      this.title +
      "'\n" +
      '  @steps={{this.steps}}\n' +
      '  @current={{this.current}}\n' +
      '  @asset={{this.asset}}\n' +
      '/>'
    );
  }

  <template>
    <FreestyleUsage
      @name='StepsWithMedia'
      @description='A block: steps paired with a media panel. Composes StepList (the whole ordered list — markers, six states, per-step detail lines, the derived completion summary, the polite live region) and MediaViewer (the panel). Step semantics are not reimplemented here; this block contributes the column and nothing else. The media is a STATIC column on purpose: per-step switching needs a selected index, a keyboard path and an announcement, which is a state machine and therefore a component. A caller who already owns a selected index passes a different asset alongside a different current and gets per-step media with the state living where state belongs.'
      @source={{this.usage}}
    >
      <:example>
        <StepsWithMedia
          @eyebrow={{this.eyebrow}}
          @title={{this.title}}
          @lead={{this.lead}}
          @steps={{this.steps}}
          @current={{this.current}}
          @variant={{this.railVariant}}
          @summary={{this.summary}}
          @asset={{this.asset}}
          @mediaSide={{this.side}}
          @ratio='16 / 9'
        />
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='steps'
          @description='The steps, handed straight to StepList. Each is label plus an optional state and detail line, so a step can say it is blocked and why.'
        />
        <Args.Number
          @name='current'
          @value={{this.current}}
          @min={{-1}}
          @max={{3}}
          @description='Index of the current step. StepList derives complete, current and upcoming for every step without an explicit state.'
          @onInput={{this.setCurrent}}
        />
        <Args.String
          @name='variant'
          @value={{this.variant}}
          @defaultValue='steps'
          @options={{this.variantOptions}}
          @description='StepList presentation. steps is the numbered rail; track is the segmented bar read at a glance.'
          @onInput={{this.setVariant}}
        />
        <Args.Bool
          @name='summary'
          @value={{this.summary}}
          @defaultValue={{false}}
          @description='Show the derived completion count, wired to the list with aria-describedby.'
          @onInput={{this.setSummary}}
        />
        <Args.String
          @name='title'
          @value={{this.title}}
          @description='Section title, and the block accessible name when present.'
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='eyebrow'
          @value={{this.eyebrow}}
          @description='Small mono line above the title.'
          @onInput={{this.setEyebrow}}
        />
        <Args.String
          @name='lead'
          @value={{this.lead}}
          @description='One paragraph under the title.'
          @onInput={{this.setLead}}
        />
        <Args.String
          @name='mediaSide'
          @value={{this.mediaSide}}
          @defaultValue='start'
          @options={{this.sideOptions}}
          @description='Which side the panel sits on VISUALLY at wide widths. Source order stays content-first.'
          @onInput={{this.setMediaSide}}
        />
        <Args.Object
          @name='asset'
          @description='The media panel asset, routed by MediaViewer. A video gets the kit player — transport, captions, keyboard, and no autoplay, which is what the source autoplaying GIF got wrong.'
        />
        <Args.String
          @name='ratio'
          @description='Hold the panel at a fixed aspect ratio.'
        />
        <Args.Yield
          @name='media'
          @description='Replaces the media panel. This is where a BrowserFrame will drop in once the kit has one.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-swm-gap'
          @type='dimension'
          @description='Gap between the panel and the steps at wide widths.'
        />
        <Css.Basic
          @name='pretui-swm-media-fr'
          @type='dimension'
          @description='Track size for the media column.'
        />
        <Css.Basic
          @name='pretui-swm-sticky-top'
          @type='dimension'
          @description='Sticky offset for the panel while the steps scroll past. Sticky is cancelled once the grid collapses, so a single column never pins the picture over the steps.'
        />
      </:cssVars>
    </FreestyleUsage>
  </template>
}

// ═════════════════════════════════════════════════════════════════════════
// CtaBand
// ═════════════════════════════════════════════════════════════════════════

export const DEMOS_STEPS_WITH_MEDIA: Record<string, unknown> = {
  StepsWithMedia: StepsWithMediaUsage,
};
