// Pretui — AspectRatio usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { AspectRatio } from './aspect-ratio';
import type { AspectFit } from './aspect-ratio';
import { FreestyleUsage } from './freestyle-usage';
import { SWATCH } from '../internal/structure-layout-fixtures';

// ── AspectRatio ──────────────────────────────────────────────────────────

export class AspectRatioUsage extends Component {
  @tracked ratio = '16 / 9';
  @tracked fit = 'actual';
  @tracked bordered = true;
  @tracked alt = 'Estate at dawn';

  ratioOptions = ['1', '4 / 3', '16 / 9', '3 / 4', '21 / 9'];
  fitOptions = ['actual', 'contain', 'cover'];
  swatch = SWATCH;

  setRatio = (v: string) => {
    this.ratio = v;
  };
  setFit = (v: string) => {
    this.fit = v;
  };
  setBordered = (v: boolean) => {
    this.bordered = v;
  };
  setAlt = (v: string) => {
    this.alt = v;
  };

  get fitValue(): AspectFit {
    return this.fit as AspectFit;
  }

  get usage(): string {
    return [
      '<AspectRatio',
      "  @ratio='" + this.ratio + "'",
      "  @fit='" + this.fit + "'",
      '  @src={{this.photo}}',
      "  @alt='" + this.alt + "'",
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='AspectRatio'
      @description='A box that reserves its shape before its content arrives. One element and the real CSS aspect-ratio property, not the percentage-padding wrapper Radix and Chakra still ship. Also exported as AspectBox — Gallery, AssetWell, MediaPlayer, CopyFit and Skeleton all want this same frame, and there should be one of it.'
      @source={{this.usage}}
    >
      <:example>
        <div class='ar-stage'>
          <AspectRatio
            @ratio={{this.ratio}}
            @fit={{this.fitValue}}
            @src={{this.swatch}}
            @alt={{this.alt}}
            @bordered={{this.bordered}}
          />
          <p class='ar-note'>Clear the alt text and watch the painted modes drop
            their image role entirely. An unnamed image role announces as
            &quot;image&quot; and nothing else, which is worse than being a
            plain box.</p>
        </div>

        <p class='ar-note'>Framing arbitrary content — the box is a single-cell
          grid, so the child stretches without this component styling anything
          the caller wrote:</p>
        <div class='ar-stage'>
          <AspectRatio @ratio='4 / 3' @bordered={{true}}>
            <div class='ar-slot'>4 : 3</div>
          </AspectRatio>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='ratio'
          @description='A number or the CSS spelling. Every React kit takes a pre-divided float, so 16/9 arrives in DevTools as 1.7777777777777777 with the authoring intent gone.'
          @options={{this.ratioOptions}}
          @value={{this.ratio}}
          @onInput={{this.setRatio}}
          @defaultValue='1'
        />
        <Args.String
          @name='fit'
          @description='actual renders a real img with intrinsic width and height, lazy loading and real alt — the accessible default. contain and cover paint a background image on a labelled box, which is the right choice when the image is a surface rather than content.'
          @options={{this.fitOptions}}
          @value={{this.fit}}
          @onInput={{this.setFit}}
          @defaultValue='actual'
        />
        <Args.String
          @name='src'
          @description='Image source. In the painted modes it is parsed with the platform URL constructor and only emitted as a quoted url token for a protocol on the allowlist — the shared kit guard deliberately rejects url entirely, so only a component that is about an image can write one.'
        />
        <Args.String
          @name='alt'
          @description='The accessible name. Empty or omitted means decorative: the img keeps an empty alt, and the painted modes drop the image role rather than leave an unnamed one in the tree.'
          @value={{this.alt}}
          @onInput={{this.setAlt}}
        />
        <Args.Bool
          @name='bordered'
          @description='Draw the kit hairline around the frame.'
          @defaultValue={{false}}
          @value={{this.bordered}}
          @onInput={{this.setBordered}}
        />
        <Args.Number
          @name='width'
          @description='Intrinsic pixel width for the actual mode, so the browser reserves space before the bytes land.'
        />
        <Args.Yield
          @name='default'
          @description='Arbitrary framed content — an iframe, a canvas, a chart, a map. Chakra throws outright on a conditionally-null child here.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-aspect-object-fit'
          @type='string'
          @description='object-fit for the actual mode. Mantine and Chakra hardcode cover with no escape.'
          @defaultValue='cover'
        />
        <Css.Basic
          @name='pretui-aspect-bg'
          @type='color'
          @description='The ground behind a contain letterbox.'
          @defaultValue='color-mix(in oklch, var(--foreground) 6%, var(--card))'
        />
        <Css.Basic
          @name='pretui-aspect-radius'
          @type='dimension'
          @description='Corner radius of the frame.'
          @defaultValue='var(--radius)'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .ar-stage {
        max-inline-size: 380px;
        padding: var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .ar-note {
        margin: var(--space-4, 11px) 0 var(--space-3, 8px);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .ar-slot {
        display: grid;
        place-items: center;
        block-size: 100%;
        font-family: var(--font-mono);
        font-size: var(--text-ui-lg, 14px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_ASPECT_RATIO: Record<string, unknown> = {
  AspectRatio: AspectRatioUsage,
};
