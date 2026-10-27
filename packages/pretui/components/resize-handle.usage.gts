// Pretui — ResizeHandle usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { FreestyleUsage } from './freestyle-usage';
import { ResizeHandle, type ResizeHandlePlacementAlias } from './resize-handle';

// The demo pane's bounds: a sidebar beside the content, or a console under it.
const BOUNDS = {
  vertical: { min: '10rem', max: '20rem', defaultSize: '12rem' },
  horizontal: { min: '3rem', max: '9rem', defaultSize: '5rem' },
};

class ResizeHandleUsage extends Component {
  orientationOptions = ['vertical', 'horizontal'];
  placementOptions = ['end', 'start', 'left', 'right', 'top', 'bottom'];
  @tracked size: number | undefined = undefined;
  @tracked orientation: 'vertical' | 'horizontal' = 'vertical';
  @tracked placement: ResizeHandlePlacementAlias = 'end';
  @tracked step = 16;
  setSize = (size: number) => (this.size = size);
  // The two orientations size different things, so a switch starts the pane
  // over at its default.
  setOrientation = (v: string) => {
    this.orientation = v === 'horizontal' ? 'horizontal' : 'vertical';
    this.size = undefined;
  };
  setPlacement = (v: string) =>
    (this.placement = v as ResizeHandlePlacementAlias);
  setStep = (v: number | null) => (this.step = v ?? 16);
  get bounds() {
    return BOUNDS[this.orientation];
  }
  // The demo lays out left to right, so the physical placements line up
  // with the logical ones.
  get edge(): 'start' | 'end' {
    return ['start', 'left', 'top'].includes(this.placement) ? 'start' : 'end';
  }
  get paneStyle() {
    return htmlSafe(
      this.size === undefined ? '' : `--_pane-size: ${this.size}px`,
    );
  }
  get usage() {
    let { min, max, defaultSize } = this.bounds;
    let bits = [
      '@size={{this.size}}',
      `@min='${min}'`,
      `@max='${max}'`,
      `@defaultSize='${defaultSize}'`,
      '@onSizeChange={{this.setSize}}',
      `@label='${this.label}'`,
    ];
    if (this.orientation !== 'vertical') {
      bits.push(`@orientation='${this.orientation}'`);
    }
    if (this.placement !== 'end') {
      bits.push(`@placement='${this.placement}'`);
    }
    if (this.step !== 16) {
      bits.push(`@step={{${this.step}}}`);
    }
    return `<ResizeHandle ${bits.join(' ')} />`;
  }
  get label() {
    return this.orientation === 'vertical'
      ? 'Resize sidebar'
      : 'Resize console';
  }
  get paneName() {
    return this.orientation === 'vertical' ? 'Sidebar' : 'Console';
  }
  <template>
    <FreestyleUsage
      @name='ResizeHandle'
      @description='A focusable separator that resizes the pane beside it, in px. The caller owns the size: @size in, @onSizeChange out. Drag it, use the arrow keys (Shift for bigger steps, Home and End for the limits), or double-click or press Enter to restore @defaultSize. Use it to size one pane next to content that keeps its own layout; to share out a whole group of panes in percent, use SplitPanes.'
      @source={{this.usage}}
    >
      <:example>
        <div
          class='rh-host'
          data-orientation={{this.orientation}}
          data-edge={{this.edge}}
        >
          <div id='rh-usage-pane' class='rh-pane' style={{this.paneStyle}}>
            <span class='rh-label'>{{this.paneName}}</span>
            <ResizeHandle
              class='rh-handle'
              @size={{this.size}}
              @min={{this.bounds.min}}
              @max={{this.bounds.max}}
              @defaultSize={{this.bounds.defaultSize}}
              @orientation={{this.orientation}}
              @step={{this.step}}
              @placement={{this.placement}}
              @onSizeChange={{this.setSize}}
              @label={{this.label}}
              @controls='rh-usage-pane'
            />
          </div>
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
          @description='The size double-click and Enter restore, and the size an unset @size reads as.'
        />
        <Args.String
          @name='orientation'
          @defaultValue='vertical'
          @value={{this.orientation}}
          @options={{this.orientationOptions}}
          @description='The separator line itself: vertical resizes width, horizontal resizes height.'
          @onInput={{this.setOrientation}}
        />
        <Args.String
          @name='placement'
          @defaultValue='end'
          @value={{this.placement}}
          @options={{this.placementOptions}}
          @description='The pane edge the handle sits on. start and end are logical and follow the writing direction; left and right are physical; top and bottom name the block axis.'
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
        block-size: 12rem;
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .rh-host[data-edge='start'] {
        flex-direction: row-reverse;
      }
      .rh-host[data-orientation='horizontal'] {
        flex-direction: column;
      }
      .rh-host[data-orientation='horizontal'][data-edge='start'] {
        flex-direction: column-reverse;
      }
      .rh-pane {
        --_pane-size: 12rem;
        position: relative;
        flex-shrink: 0;
        inline-size: var(--_pane-size);
        background-color: var(--muted);
      }
      [data-orientation='horizontal'] > .rh-pane {
        --_pane-size: 5rem;
        inline-size: auto;
        block-size: var(--_pane-size);
      }
      .rh-handle {
        position: absolute;
        inset-block: 0;
        inset-inline-end: 0;
      }
      [data-edge='start'] .rh-handle {
        inset-inline-end: auto;
        inset-inline-start: 0;
      }
      [data-orientation='horizontal'] .rh-handle {
        inset-block: auto 0;
        inset-inline: 0;
      }
      [data-orientation='horizontal'][data-edge='start'] .rh-handle {
        inset-block: 0 auto;
      }
      .rh-main {
        flex-grow: 1;
        min-inline-size: 0;
        min-block-size: 0;
      }
      .rh-label {
        display: block;
        padding: var(--boxel-sp-sm);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_RESIZE_HANDLE: Record<string, unknown> = {
  ResizeHandle: ResizeHandleUsage,
};
