// Pretui — ResizeHandle usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { FreestyleUsage } from './freestyle-usage';
import { ResizeHandle } from './resize-handle';

class ResizeHandleUsage extends Component {
  placementOptions = ['end', 'start'];
  @tracked size: number | undefined = undefined;
  @tracked placement = 'end';
  @tracked step = 16;
  setSize = (size: number) => (this.size = size);
  setPlacement = (v: string) => (this.placement = v);
  setStep = (v: number | null) => (this.step = v ?? 16);
  get placementVal() {
    return this.placement as 'start' | 'end';
  }
  get paneStyle() {
    return htmlSafe(
      this.size === undefined ? '' : `--pane-width: ${this.size}px`,
    );
  }
  get usage() {
    let bits = [
      '@size={{this.width}}',
      "@min='10rem'",
      "@max='20rem'",
      "@defaultSize='12rem'",
      '@onSizeChange={{this.setWidth}}',
      "@label='Resize sidebar'",
    ];
    if (this.placement !== 'end') {
      bits.push(`@placement='${this.placement}'`);
    }
    return `<ResizeHandle ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='ResizeHandle'
      @description='A focusable separator that resizes the pane beside it, in px. The caller owns the size: @size in, @onSizeChange out. Drag it, use the arrow keys (Shift for bigger steps, Home and End for the limits), or double-click to restore @defaultSize. Use it to size one pane next to content that keeps its own layout; to share out a whole group of panes in percent, use SplitPanes.'
      @source={{this.usage}}
    >
      <:example>
        <div class='rh-host' data-placement={{this.placement}}>
          <nav id='rh-usage-pane' class='rh-pane' style={{this.paneStyle}}>
            <span class='rh-label'>Sidebar</span>
            <ResizeHandle
              class='rh-handle'
              @size={{this.size}}
              @min='10rem'
              @max='20rem'
              @defaultSize='12rem'
              @step={{this.step}}
              @placement={{this.placementVal}}
              @onSizeChange={{this.setSize}}
              @label='Resize sidebar'
              @controls='rh-usage-pane'
            />
          </nav>
          <div class='rh-main'><span class='rh-label'>Content</span></div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='size'
          @value={{this.size}}
          @description='The pane size in px. Unset reads as @defaultSize, so CSS can own the size until the first resize.'
        />
        <Args.Action
          @name='onSizeChange'
          @description='Receives the next size in px, already clamped and rounded. Fires on every pointer move, so keep it cheap.'
        />
        <Args.String
          @name='min'
          @defaultValue='0'
          @description='Smallest size: a px number, or a px or rem string.'
        />
        <Args.String
          @name='max'
          @description='Largest size: a px number, or a px or rem string. Unbounded when unset, and End does nothing.'
        />
        <Args.String
          @name='defaultSize'
          @description='The size double-click restores, and the size an unset @size reads as.'
        />
        <Args.String
          @name='orientation'
          @defaultValue='vertical'
          @options={{this.orientationOptions}}
          @description='The separator line itself: vertical resizes width, horizontal resizes height.'
        />
        <Args.String
          @name='placement'
          @defaultValue='end'
          @value={{this.placement}}
          @options={{this.placementOptions}}
          @description='The pane edge the handle sits on. Logical, so it follows the writing direction; left, right, top and bottom are accepted too.'
          @onInput={{this.setPlacement}}
        />
        <Args.Number
          @name='step'
          @defaultValue={{16}}
          @value={{this.step}}
          @description='px per arrow key press. Shift moves four steps.'
          @onInput={{this.setStep}}
        />
        <Args.String
          @name='label'
          @defaultValue='Resize'
          @description='Accessible name. Name the pane, e.g. "Resize sidebar".'
        />
        <Args.String
          @name='controls'
          @description='The id of the pane, for aria-controls.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .rh-host {
        display: flex;
        block-size: 10rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-card, 8px);
        overflow: hidden;
      }
      .rh-host[data-placement='start'] {
        flex-direction: row-reverse;
      }
      .rh-pane {
        position: relative;
        flex-shrink: 0;
        inline-size: var(--pane-width, 12rem);
        background: var(--muted);
      }
      .rh-handle {
        position: absolute;
        inset-block: 0;
        inset-inline-end: 0;
      }
      .rh-host[data-placement='start'] .rh-handle {
        inset-inline-end: auto;
        inset-inline-start: 0;
      }
      .rh-main {
        flex-grow: 1;
        min-inline-size: 0;
      }
      .rh-label {
        display: block;
        padding: var(--boxel-sp-sm, 0.75rem);
        color: var(--muted-foreground);
      }
    </style>
  </template>

  orientationOptions = ['vertical', 'horizontal'];
}

export const DEMOS_RESIZE_HANDLE: Record<string, unknown> = {
  ResizeHandle: ResizeHandleUsage,
};
