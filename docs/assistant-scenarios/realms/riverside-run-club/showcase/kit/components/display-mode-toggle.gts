// Pretui — DisplayModeToggle: expand an MCP App to fullscreen or picture-in-picture, when the host offers it.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import MaximizeIcon from '@cardstack/boxel-icons/maximize-2';
import MinimizeIcon from '@cardstack/boxel-icons/minimize-2';
import PipIcon from '@cardstack/boxel-icons/picture-in-picture-2';

export type AppDisplayMode = 'inline' | 'fullscreen' | 'pip';

export interface DisplayModeToggleSignature {
  Args: {
    /** the mode the host shows the app in now */
    mode: AppDisplayMode | string;
    /** the modes the host offers (`availableDisplayModes`). Only these
     * render, so a host without picture-in-picture shows no PiP button */
    available: string[];
    /** ask the host for a mode; resolve to the mode it gave, which may be
     * the one it kept */
    onRequest: (mode: AppDisplayMode) => Promise<string | undefined> | string | undefined;
  };
  Element: HTMLSpanElement;
}

/**
 * Expand / Collapse and PiP as one control in the AppBar. It shows only
 * the modes the host advertises, is busy while a request is out, and says
 * so when the host kept its view, instead of failing silently.
 */
export class DisplayModeToggle extends Component<DisplayModeToggleSignature> {
  @tracked busy = false;
  @tracked kept: string | undefined;

  get expanded() {
    return this.args.mode === 'fullscreen';
  }
  get canExpand() {
    return this.args.available.includes(this.expanded ? 'inline' : 'fullscreen') || this.expanded;
  }
  get canPip() {
    return this.args.available.includes('pip') && this.args.mode !== 'pip';
  }
  request = async (mode: AppDisplayMode) => {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.kept = undefined;
    try {
      let given = await this.args.onRequest(mode);
      if (given && given !== mode) {
        this.kept = `The host kept its ${given} view`;
      }
    } catch {
      this.kept = 'The host did not change the view';
    } finally {
      if (!this.isDestroying && !this.isDestroyed) {
        this.busy = false;
      }
    }
  };
  <template>
    <span class='pretui-displaymode' role='group' aria-label='View' aria-busy={{if this.busy 'true'}} data-test-pretui-display-mode ...attributes>
      {{#if this.canExpand}}
        <button
          type='button'
          class='pretui-displaymode-btn'
          aria-label={{if this.expanded 'Collapse to the chat' 'Expand to fullscreen'}}
          disabled={{this.busy}}
          data-test-pretui-display-mode-expand
          {{on 'click' (fn this.request (if this.expanded 'inline' 'fullscreen'))}}
        >{{#if this.expanded}}<MinimizeIcon width='14' height='14' aria-hidden='true' />{{else}}<MaximizeIcon width='14' height='14' aria-hidden='true' />{{/if}}</button>
      {{/if}}
      {{#if this.canPip}}
        <button
          type='button'
          class='pretui-displaymode-btn'
          aria-label='Picture in picture'
          disabled={{this.busy}}
          data-test-pretui-display-mode-pip
          {{on 'click' (fn this.request 'pip')}}
        ><PipIcon width='14' height='14' aria-hidden='true' /></button>
      {{/if}}
      {{#if this.kept}}<span class='pretui-displaymode-kept' role='status'>{{this.kept}}</span>{{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-displaymode {
          display: inline-flex;
          align-items: center;
          gap: 2px;
        }
        .pretui-displaymode-btn {
          display: inline-grid;
          place-items: center;
          width: 26px;
          height: 26px;
          padding: 0;
          border: 0;
          border-radius: 6px;
          background: none;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-displaymode-btn:hover:not(:disabled) {
          color: var(--pretui-link, var(--primary));
          background: var(--hover, var(--inset));
        }
        .pretui-displaymode-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .pretui-displaymode-btn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-displaymode-kept {
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
        }
      }
    </style>
  </template>
}
