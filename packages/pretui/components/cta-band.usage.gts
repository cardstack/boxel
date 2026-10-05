// Pretui — CtaBand usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import type { PretuiAppearance, PretuiTone } from '../pretui-primitives';
import { CtaBand } from './cta-band';

class CtaBandUsage extends Component {
  @tracked eyebrow = 'One more thing';
  @tracked headline = 'List your first lot this week';
  @tracked lead =
    'Sellers keep their own terms and their own reserve. We take nothing until it settles.';
  @tracked tone = 'primary';
  @tracked appearance = 'accent';
  @tracked align = 'center';

  setEyebrow = (v: string) => (this.eyebrow = v);
  setHeadline = (v: string) => (this.headline = v);
  setLead = (v: string) => (this.lead = v);
  setTone = (v: string) => (this.tone = v);
  setAppearance = (v: string) => (this.appearance = v);
  setAlign = (v: string) => (this.align = v);

  get toneOptions(): string[] {
    return [
      'neutral',
      'primary',
      'info',
      'success',
      'warning',
      'danger',
      'attention',
    ];
  }
  get appearanceOptions(): string[] {
    return ['accent', 'filled', 'outlined', 'filled-outlined', 'plain'];
  }
  get alignOptions(): string[] {
    return ['center', 'start'];
  }
  get bandTone(): PretuiTone {
    return this.tone as PretuiTone;
  }
  get bandAppearance(): PretuiAppearance {
    return this.appearance as PretuiAppearance;
  }
  get bandAlign(): 'start' | 'center' {
    return this.align === 'start' ? 'start' : 'center';
  }
  /** The dark closing band the source hardcoded as #14141a — here it is
   * two args, and a season re-dresses it. */
  get darkTone(): PretuiTone {
    return 'neutral';
  }
  get darkAppearance(): PretuiAppearance {
    return 'accent';
  }

  get usage(): string {
    return (
      '<CtaBand\n' +
      "  @headline='" +
      this.headline +
      "'\n" +
      "  @tone='" +
      this.tone +
      "'\n" +
      "  @appearance='" +
      this.appearance +
      "'\n" +
      '>\n' +
      '  <:actions><Button>List a lot</Button></:actions>\n' +
      '</CtaBand>'
    );
  }

  <template>
    <FreestyleUsage
      @name='CtaBand'
      @description='The closing call-to-action band. Ladder note, stated plainly: this is the one of the four that is NOT really a block — it composes no kit component, and its whole value is a surface treatment plus slots, which is component work. Its honest tier is Surfaces. What it does do is wear the full the tone × appearance grid: tone picks the hue and sets two custom properties, appearance picks the recipe, the recipes are written once and read those properties, and the resolved axes are reflected as data-tone and data-appearance. Thirty-five dresses, no hand-authored pairs, and the dark band the source nailed to a hex is just neutral plus accent.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-cta-demo'>
          <CtaBand
            @eyebrow={{this.eyebrow}}
            @headline={{this.headline}}
            @lead={{this.lead}}
            @tone={{this.bandTone}}
            @appearance={{this.bandAppearance}}
            @align={{this.bandAlign}}
          >
            <:actions>
              <Button @tone='neutral' @appearance='outlined' @size='l'>
                Talk to us first
              </Button>
              <Button @tone='primary' @size='l'>List a lot</Button>
            </:actions>
          </CtaBand>

          <CtaBand
            @headline='The same band, tone neutral, appearance accent'
            @lead='This is the dark closing band the source hardcoded. Nothing here is a hex; a season re-dresses it and a dark theme inverts it.'
            @tone={{this.darkTone}}
            @appearance={{this.darkAppearance}}
            @align='start'
          >
            <:actions>
              <Button @tone='primary' @size='m'>List a lot</Button>
            </:actions>
          </CtaBand>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='headline'
          @value={{this.headline}}
          @required={{true}}
          @description='The headline. It names the band through aria-labelledby.'
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
        <Args.String
          @name='tone'
          @value={{this.tone}}
          @defaultValue='primary'
          @options={{this.toneOptions}}
          @description='Semantic hue. It sets two custom properties and nothing else in the stylesheet knows a hue.'
          @onInput={{this.setTone}}
        />
        <Args.String
          @name='appearance'
          @value={{this.appearance}}
          @defaultValue='accent'
          @options={{this.appearanceOptions}}
          @description='Visual weight. Each recipe also sets the ink pair the eyebrow and lead read, so the type follows the recipe without a second set of rules.'
          @onInput={{this.setAppearance}}
        />
        <Args.String
          @name='align'
          @value={{this.align}}
          @defaultValue='center'
          @options={{this.alignOptions}}
          @description='center for a closing band, start when it sits inside a column of left-aligned prose.'
          @onInput={{this.setAlign}}
        />
        <Args.Number
          @name='headingLevel'
          @defaultValue={{2}}
          @description='Heading level in the host page.'
        />
        <Args.Yield
          @name='actions'
          @description='The call-to-action controls. The source said List it and shipped no control at all; this is the point of the component.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-cta-pad'
          @type='dimension'
          @description='Band padding at wide widths.'
        />
        <Css.Basic
          @name='pretui-cta-measure'
          @type='dimension'
          @description='Maximum measure of the inner column, so a centred band never runs a 120-character line.'
        />
        <Css.Basic
          @name='pretui-cta-headline-size'
          @type='dimension'
          @description='Headline size.'
        />
        <Css.Basic
          @name='pretui-band-ink'
          @type='color'
          @description='Ink for the headline, set by the appearance recipe. Override it only to break the recipe deliberately.'
        />
        <Css.Basic
          @name='pretui-band-ink-quiet'
          @type='color'
          @description='Ink for the eyebrow and the lead, set by the same recipe.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-cta-demo {
        display: grid;
        gap: var(--space-5, 14px);
      }
    </style>
  </template>
}

export const DEMOS_CTA_BAND: Record<string, unknown> = {
  CtaBand: CtaBandUsage,
};
