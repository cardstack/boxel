// Pretui — ZoomableFrame usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { ZoomableFrame } from './zoomable-frame';

// ── ZoomableFrame ────────────────────────────────────────────────────────
export class ZoomableFrameUsage extends Component {
  @tracked scale = 1;

  onScaleChange = (scale: number) => {
    this.scale = scale;
  };

  get percent(): string {
    return Math.round(this.scale * 100) + '%';
  }

  get usage(): string {
    return [
      "<ZoomableFrame @label='Warehouse floor plan'>",
      '  <img src={{this.planUrl}} alt="" />',
      '</ZoomableFrame>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='ZoomableFrame'
      @description='A zoom-and-pan viewport around ordinary DOM — a card, a chart, an image, a plan. Every pointer gesture has a keyboard twin: plus and minus zoom, the arrows pan, shift coarsens the step and zero resets. Pinch works the same on a trackpad, a pen and two thumbs, through one unified pointer path rather than a separate touch branch.'
      @source={{this.usage}}
      @viewportMode='wide'
    >
      <:example>
        <div class='frame-stage'>
          <ZoomableFrame
            @label='Warehouse floor plan'
            @onScaleChange={{this.onScaleChange}}
          >
            <div class='frame-plan'>
              <div class='frame-bay' data-bay='A'>Bay A</div>
              <div class='frame-bay' data-bay='B'>Bay B</div>
              <div class='frame-bay' data-bay='C'>Bay C</div>
              <div class='frame-bay' data-bay='D'>Bay D</div>
              <div class='frame-dock'>Dock</div>
            </div>
          </ZoomableFrame>
          <p class='frame-note'>Reported scale
            <strong>{{this.percent}}</strong>. Click the frame and press
            <kbd>+</kbd>,
            <kbd>-</kbd>, the arrow keys or
            <kbd>0</kbd>; or drag, or pinch.</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @description='Accessible name for the viewport. Required in practice — it is the only thing a screen reader can say about a pannable box.'
        />
        <Args.Number
          @name='min'
          @description='Smallest scale.'
          @defaultValue={{0.25}}
        />
        <Args.Number
          @name='max'
          @description='Largest scale.'
          @defaultValue={{4}}
        />
        <Args.Number
          @name='step'
          @description='Multiplier per zoom step from a button or a key. Multiplicative rather than additive, so a step feels the same at 25% and at 400%.'
          @defaultValue={{1.25}}
        />
        <Args.Number
          @name='scale'
          @description='Controlled scale. Omit for uncontrolled.'
        />
        <Args.Action
          @name='onScaleChange'
          @description='Fires with the next scale on every change — button, key, wheel or pinch.'
        />
        <Args.Bool
          @name='hideToolbar'
          @description='Hide the toolbar. The keyboard and pointer paths are unaffected, but the readout goes with it — only reach for this when the scale is displayed somewhere else.'
          @defaultValue={{false}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-frame-height'
          @type='dimension'
          @description='Viewport height.'
          @defaultValue='360px'
        />
        <Css.Basic
          @name='pretui-frame-ground'
          @type='color'
          @description='Colour behind the framed content.'
          @defaultValue='var(--muted)'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .frame-stage {
        display: grid;
        gap: var(--space-3, 8px);
      }
      .frame-plan {
        inline-size: 420px;
        block-size: 260px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr auto;
        gap: 6px;
        padding: 10px;
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .frame-bay {
        display: grid;
        place-items: center;
        border-radius: var(--radius-control, 7px);
        background: color-mix(in oklch, var(--chart-2) 12%, transparent);
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: var(--weight-strong, 600);
        color: var(--foreground);
      }
      .frame-bay[data-bay='C'],
      .frame-bay[data-bay='D'] {
        background: color-mix(in oklch, var(--chart-3) 12%, transparent);
      }
      .frame-dock {
        grid-column: 1 / -1;
        display: grid;
        place-items: center;
        padding-block: 8px;
        border-radius: var(--radius-control, 7px);
        background: color-mix(
          in oklch,
          var(--muted-foreground) 14%,
          transparent
        );
        font-size: var(--text-ui-xs, 11px);
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .frame-note {
        margin: 0;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .frame-note kbd {
        font-family: var(--font-mono);
        padding: 1px 5px;
        border-radius: 4px;
        background: color-mix(
          in oklch,
          var(--foreground) 8%,
          transparent
        );
      }
    </style>
  </template>
}

export const DEMOS_ZOOMABLE_FRAME: Record<string, unknown> = {
  ZoomableFrame: ZoomableFrameUsage,
};
