// Pretui — HeroSplit usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import type { MediaAssetSpec } from '../internal/media-viewer';
import { platePoster } from '../media-examples';
import { HeroSplit } from './hero-split';

const HERO_ASSET: MediaAssetSpec = {
  src: platePoster('Sourcing floor, Kandy', '4 / 3'),
  name: 'Sourcing floor, Kandy',
  mimeType: 'image/svg+xml',
  kind: 'image',
  alt: 'A generated stand-in plate of a sourcing floor',
  width: 1600,
  height: 1200,
};

class HeroSplitUsage extends Component {
  @tracked eyebrow = 'Direct from origin';
  @tracked headline = 'Buy the lot, not the story';
  @tracked lead =
    'Every lot on the floor arrives measured — origin, grade, moisture, and the last three prices it fetched. You bid against a number, not a photograph.';
  @tracked mediaSide = 'end';
  @tracked ratio = '4 / 3';
  @tracked useRatio = true;

  setEyebrow = (v: string) => (this.eyebrow = v);
  setHeadline = (v: string) => (this.headline = v);
  setLead = (v: string) => (this.lead = v);
  setMediaSide = (v: string) => (this.mediaSide = v);
  setRatio = (v: string) => (this.ratio = v);
  setUseRatio = (v: boolean) => (this.useRatio = v);

  get sideOptions(): string[] {
    return ['start', 'end'];
  }
  get ratioOptions(): string[] {
    return ['4 / 3', '16 / 9', '1 / 1', '3 / 4'];
  }
  get side(): 'start' | 'end' {
    return this.mediaSide === 'start' ? 'start' : 'end';
  }
  get appliedRatio(): string | undefined {
    return this.useRatio ? this.ratio : undefined;
  }
  get asset(): MediaAssetSpec {
    return HERO_ASSET;
  }
  get chips() {
    return [
      { label: 'Lot-level provenance' },
      { label: 'Settlement in 48h' },
      { label: 'No buyer premium' },
      { label: 'Sample before you bid' },
    ];
  }

  get usage(): string {
    return (
      '<HeroSplit\n' +
      "  @eyebrow='" +
      this.eyebrow +
      "'\n" +
      "  @headline='" +
      this.headline +
      "'\n" +
      '  @chips={{this.chips}}\n' +
      '  @asset={{this.asset}}\n' +
      "  @mediaSide='" +
      this.side +
      "'\n" +
      '>\n' +
      '  <:actions><Button>Browse lots</Button></:actions>\n' +
      '</HeroSplit>'
    );
  }

  <template>
    <FreestyleUsage
      @name='HeroSplit'
      @description='A block: the split hero. Composes MediaViewer (the stage, which picks an image, video or audio adapter by itself and reserves the space before the bytes arrive) and Chip (the strip), with the call-to-action controls supplied by the caller as Buttons. The content column is always the FIRST child in source order, whichever side the picture is on, so a screen reader and a keyboard pass always meet the headline first. Narrow the artboard: the grid collapses to one column and the visual order rejoins the source order. The measurement is a container query against the block own box, not the viewport, so a hero inside a narrow card pane stacks even on a wide screen.'
      @source={{this.usage}}
    >
      <:example>
        <HeroSplit
          @eyebrow={{this.eyebrow}}
          @headline={{this.headline}}
          @lead={{this.lead}}
          @chips={{this.chips}}
          @asset={{this.asset}}
          @mediaSide={{this.side}}
          @ratio={{this.appliedRatio}}
        >
          <:actions>
            <Button @tone='primary' @size='l'>Browse lots</Button>
            <Button @tone='neutral' @appearance='outlined' @size='l'>
              How the floor works
            </Button>
          </:actions>
        </HeroSplit>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='headline'
          @value={{this.headline}}
          @required={{true}}
          @description='The headline. It is also the block accessible name, through aria-labelledby.'
          @onInput={{this.setHeadline}}
        />
        <Args.String
          @name='eyebrow'
          @value={{this.eyebrow}}
          @description='Small mono line above the headline.'
          @onInput={{this.setEyebrow}}
        />
        <Args.String
          @name='lead'
          @value={{this.lead}}
          @description='One paragraph under the headline.'
          @onInput={{this.setLead}}
        />
        <Args.Array
          @name='chips'
          @description='The chip strip, as data. Each entry is label plus an optional hue token; the leading dot is off by default because a hero chip is a feature label, not a status.'
        />
        <Args.Object
          @name='asset'
          @description='The media stage asset, routed by MediaViewer. Give it width and height and the space is reserved before it loads.'
        />
        <Args.String
          @name='mediaSide'
          @value={{this.mediaSide}}
          @defaultValue='end'
          @options={{this.sideOptions}}
          @description='Which side the picture sits on VISUALLY at wide widths. Source order is content-first either way, and at narrow widths the override is cancelled so the picture never precedes the headline.'
          @onInput={{this.setMediaSide}}
        />
        <Args.Bool
          @name='useRatio'
          @value={{this.useRatio}}
          @defaultValue={{true}}
          @description='Demo knob: pass a ratio or leave it out. Without one the stage takes the asset own ratio.'
          @onInput={{this.setUseRatio}}
        />
        <Args.String
          @name='ratio'
          @value={{this.ratio}}
          @options={{this.ratioOptions}}
          @description='Hold the stage at a fixed aspect ratio. A landscape asset letterboxes inside it; a portrait asset is centred and clipped evenly. Neither is distorted.'
          @onInput={{this.setRatio}}
        />
        <Args.Number
          @name='headingLevel'
          @defaultValue={{2}}
          @description='Heading level for the headline. A hero is often the page h1.'
        />
        <Args.Yield
          @name='media'
          @description='Replaces the media stage entirely. A hero that cycles images is a Carousel, and Carousel already has navigation, keyboard support and a reduced-motion contract — put one here rather than asking a stateless block to rotate.'
        />
        <Args.Yield
          @name='actions'
          @description='The call-to-action controls. Buttons come from the caller so their tone, appearance and behaviour stay the caller decision.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-hero-gap'
          @type='dimension'
          @description='Gap between the two columns at wide widths.'
        />
        <Css.Basic
          @name='pretui-hero-media-fr'
          @type='dimension'
          @description='Track size for the media column, so a hero can run 2fr of prose against 1fr of picture.'
        />
        <Css.Basic
          @name='pretui-hero-headline-size'
          @type='dimension'
          @description='Headline size at wide widths.'
        />
        <Css.Basic
          @name='pretui-hero-headline-size-narrow'
          @type='dimension'
          @description='Headline size once the grid has collapsed.'
        />
      </:cssVars>
    </FreestyleUsage>
  </template>
}

// ═════════════════════════════════════════════════════════════════════════
// StepsWithMedia
// ═════════════════════════════════════════════════════════════════════════

export const DEMOS_HERO_SPLIT: Record<string, unknown> = {
  HeroSplit: HeroSplitUsage,
};
