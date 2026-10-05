// Pretui — Carousel usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Carousel } from './carousel';
import { LOTS } from '../demo-structure-scroll';

// ── Carousel ─────────────────────────────────────────────────────────────
export class CarouselUsage extends Component {
  @tracked perView = 1;
  @tracked loop = false;
  @tracked hideControls = false;
  @tracked hideDots = false;
  @tracked index = 0;

  lots = LOTS;

  setPerView = (v: number | null) => {
    this.perView = v ?? 1;
  };
  setLoop = (v: boolean) => {
    this.loop = v;
  };
  setHideControls = (v: boolean) => {
    this.hideControls = v;
  };
  setHideDots = (v: boolean) => {
    this.hideDots = v;
  };
  onIndexChange = (index: number) => {
    this.index = index;
  };

  get position(): string {
    return 'Slide ' + (this.index + 1) + ' of ' + this.lots.length;
  }

  get usage(): string {
    return [
      '<Carousel',
      '  @items={{this.lots}}',
      "  @label='Featured lots'",
      '  @perView={{' + this.perView + '}}',
      '  @onIndexChange={{this.onIndexChange}}',
      '>',
      '  <:slide as |lot|>…</:slide>',
      '</Carousel>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Carousel'
      @description='A scroll-snap track with a real keyboard path. The thumb path, the momentum and the snapping are the platform’s; the arrows, the dots, Home/End and the polite “slide 3 of 7” status all route through the same goTo. Composed on Scroller rather than reimplementing edge detection. Auto-advance is deliberately not shipped — see the module header.'
      @source={{this.usage}}
      @viewportMode='wide'
    >
      <:example>
        <div class='carousel-stage'>
          <Carousel
            @items={{this.lots}}
            @label='Featured lots'
            @perView={{this.perView}}
            @loop={{this.loop}}
            @hideControls={{this.hideControls}}
            @hideDots={{this.hideDots}}
            @onIndexChange={{this.onIndexChange}}
          >
            <:slide as |lot index|>
              <article class='carousel-slide'>
                <p class='carousel-index'>{{index}}</p>
                <h4 class='carousel-tea'>{{lot.tea}}</h4>
                <p class='carousel-meta'>{{lot.id}}
                  ·
                  {{lot.place}}</p>
                <p class='carousel-chests'>{{lot.chests}}
                  chests</p>
              </article>
            </:slide>
          </Carousel>
          <p class='carousel-note'>{{this.position}}
            — reported through
            <code>@onIndexChange</code>, which fires for the arrows, the dots,
            the keyboard AND a thumb drag on the track.</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @value={{this.lots}}
          @description='The slides, yielded back to the <:slide> block in the caller’s own row type. Data-driven rather than registration-driven, so the slide count is known synchronously and the dots are right on first paint.'
        />
        <Args.String
          @name='label'
          @description='Accessible name for the carousel. It is what a rotor lists and what the slide status attaches to.'
        />
        <Args.Number
          @name='perView'
          @description='Slides visible at once. A CSS knob under the hood — the track is flex with a calc() basis, so the snap points stay right at any count.'
          @defaultValue={{1}}
          @min={{1}}
          @max={{4}}
          @step={{1}}
          @value={{this.perView}}
          @onInput={{this.setPerView}}
        />
        <Args.Bool
          @name='loop'
          @description='Wrap past the ends. Off by default: stopping is honest when the control also disables itself at the end.'
          @defaultValue={{false}}
          @value={{this.loop}}
          @onInput={{this.setLoop}}
        />
        <Args.Bool
          @name='hideControls'
          @description='Hide the previous/next buttons. The keyboard path is unaffected — arrows, Home and End keep working.'
          @defaultValue={{false}}
          @value={{this.hideControls}}
          @onInput={{this.setHideControls}}
        />
        <Args.Bool
          @name='hideDots'
          @description='Hide the dot strip. The polite status line is unaffected.'
          @defaultValue={{false}}
          @value={{this.hideDots}}
          @onInput={{this.setHideDots}}
        />
        <Args.Number
          @name='index'
          @description='Controlled index. Omit for uncontrolled — the component then keeps its own and still reports every change.'
        />
        <Args.Action
          @name='onIndexChange'
          @description='Fires with the next index whenever the reader moves, by any means. This is also the seam a host outside the realm can drive an auto-advance from, which is why the component ships none itself.'
        />
        <Args.Yield
          @name='slide'
          @description='One slide. Receives the item and its zero-based index.'
          @hideControls={{true}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-carousel-gap'
          @type='dimension'
          @description='Gap between slides. It is subtracted from the per-view basis, so slides stay flush at any @perView.'
          @defaultValue='12px'
        />
        <Css.Basic
          @name='pretui-carousel-pip'
          @type='color'
          @description='Colour of the current dot, which grows into a bar rather than cross-fading.'
          @defaultValue='var(--primary)'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .carousel-stage {
        display: grid;
        gap: var(--space-3, 8px);
        padding: var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .carousel-slide {
        block-size: 190px;
        display: grid;
        align-content: center;
        gap: 3px;
        padding: var(--space-6, 19px);
        border-radius: var(--radius-surface, 10px);
        background: var(--muted);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .carousel-index {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        font-variant-numeric: tabular-nums;
      }
      .carousel-tea {
        margin: 0;
        font-size: var(--text-heading, 19px);
        font-weight: var(--weight-heading, 700);
        letter-spacing: var(--track-heading, -0.02em);
      }
      .carousel-meta {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .carousel-chests {
        margin: 4px 0 0;
        font-variant-numeric: tabular-nums;
        font-weight: var(--weight-strong, 600);
      }
      .carousel-note {
        margin: 0;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .carousel-note code {
        font-family: var(--font-mono);
      }
    </style>
  </template>
}

export const DEMOS_CAROUSEL: Record<string, unknown> = {
  Carousel: CarouselUsage,
};
