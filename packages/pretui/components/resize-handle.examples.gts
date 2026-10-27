// Pretui — ResizeHandle example gallery.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { TEAS, seedFrom, take } from '../examples-kit';
import type { ExampleSpec } from '../examples-kit';
import { ResizeHandle } from './resize-handle';

// ── ResizeHandle ─────────────────────────────────────────────────────────
const RH = seedFrom('ResizeHandle');
const rhTeas = take(RH, 0, 6, TEAS);

class ResizeHandleFilterRail extends Component {
  @tracked width: number | undefined = undefined;
  setWidth = (width: number) => (this.width = width);
  get style() {
    return htmlSafe(
      this.width === undefined ? '' : `--_rail-width: ${this.width}px`,
    );
  }
  <template>
    <div class='ex-shell'>
      <section
        id='rh-example-rail'
        class='ex-rail'
        aria-label='Teas'
        style={{this.style}}
      >
        <ul>
          {{#each rhTeas as |tea|}}
            <li>{{tea}}</li>
          {{/each}}
        </ul>
        <ResizeHandle
          class='ex-handle'
          @size={{this.width}}
          @min='8rem'
          @max='18rem'
          @defaultSize='9rem'
          @onSizeChange={{this.setWidth}}
          @label='Resize tea list'
          @controls='rh-example-rail'
        />
      </section>
      <div class='ex-main'>Drag the rail's edge to read the long names.</div>
    </div>
    <style scoped>
      .ex-shell {
        display: flex;
        min-inline-size: 20rem;
        block-size: 11rem;
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .ex-rail {
        --_rail-width: 9rem;
        position: relative;
        flex-shrink: 0;
        inline-size: var(--_rail-width);
        background-color: var(--muted);
      }
      .ex-rail ul {
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        list-style: none;
      }
      .ex-rail li {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        line-height: 1.6;
      }
      .ex-handle {
        position: absolute;
        inset-block: 0;
        inset-inline-end: 0;
      }
      .ex-main {
        flex-grow: 1;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

class ResizeHandleConsole extends Component {
  @tracked height: number | undefined = undefined;
  setHeight = (height: number) => (this.height = height);
  get style() {
    return htmlSafe(
      this.height === undefined ? '' : `--_console-height: ${this.height}px`,
    );
  }
  <template>
    <div class='ex-stack'>
      <div class='ex-editor'>Editor</div>
      <section
        id='rh-example-console'
        class='ex-console'
        aria-label='Console'
        style={{this.style}}
      >
        <ResizeHandle
          class='ex-handle'
          @orientation='horizontal'
          @placement='start'
          @size={{this.height}}
          @min={{48}}
          @max={{144}}
          @defaultSize={{72}}
          @onSizeChange={{this.setHeight}}
          @label='Resize console'
          @controls='rh-example-console'
        />
        Console
      </section>
    </div>
    <style scoped>
      .ex-stack {
        display: flex;
        flex-direction: column;
        min-inline-size: 20rem;
        block-size: 12rem;
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .ex-editor {
        flex-grow: 1;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .ex-console {
        --_console-height: 4.5rem;
        position: relative;
        flex-shrink: 0;
        block-size: var(--_console-height);
        padding: var(--boxel-sp-sm);
        background-color: var(--muted);
        font-family: var(--font-mono);
      }
      .ex-handle {
        position: absolute;
        inset-inline: 0;
        inset-block-start: 0;
      }
    </style>
  </template>
}

export const EXAMPLES_RESIZE_HANDLE: Record<string, ExampleSpec[]> = {
  ResizeHandle: [
    {
      title: 'Filter rail',
      note: 'A rail beside content, sized in rem, widened to fit its names.',
      component: ResizeHandleFilterRail,
    },
    {
      title: 'Console',
      note: 'A horizontal handle on the top edge of a bottom panel.',
      component: ResizeHandleConsole,
    },
  ],
};
