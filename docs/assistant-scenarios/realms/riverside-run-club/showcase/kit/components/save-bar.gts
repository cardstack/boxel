// Pretui — SaveBar: the footer of a card being edited inside an MCP App: what is unsaved, and Save.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { StateGlyph } from './state-glyph';

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

export interface SaveBarSignature {
  Args: {
    /** 'clean' (nothing to save), 'dirty', 'saving', 'saved', 'error' */
    state: SaveState;
    /** how many fields changed, for "3 unsaved changes" */
    changes?: number;
    /** where it saves: 'Saved to Home renovation' */
    destination?: string;
    /** why it failed */
    error?: string;
    onSave?: () => void;
    onDiscard?: () => void;
  };
  Element: HTMLDivElement;
}

/**
 * "3 unsaved changes · Discard · Save", then "Saving…", then "✓ Saved to
 * Home renovation", at the foot of an edit-format card. Save is disabled
 * while there is nothing to save. A save refused because the card moved
 * on is not this bar's: the frame shows a ToolGate `@tone='conflict'`.
 */
export class SaveBar extends Component<SaveBarSignature> {
  get text(): string {
    switch (this.args.state) {
      case 'dirty': {
        let n = this.args.changes;
        return n ? `${n} unsaved ${n === 1 ? 'change' : 'changes'}` : 'Unsaved changes';
      }
      case 'saving':
        return 'Saving…';
      case 'saved':
        return this.args.destination ? `Saved to ${this.args.destination}` : 'Saved';
      case 'error':
        return this.args.error ?? 'Not saved';
      default:
        return 'No changes';
    }
  }
  get saving() {
    return this.args.state === 'saving';
  }
  get canDiscard() {
    return Boolean(this.args.onDiscard) && this.canSave;
  }
  get canSave() {
    return this.args.state === 'dirty' || this.args.state === 'error';
  }
  get glyph() {
    return this.args.state === 'saved' ? 'done' : this.args.state === 'error' ? 'failed' : undefined;
  }
  save = () => this.args.onSave?.();
  discard = () => this.args.onDiscard?.();
  <template>
    <div class='pretui-savebar' data-state={{@state}} data-test-pretui-save-bar={{@state}} ...attributes>
      <span class='pretui-savebar-status' role='status' aria-live='polite'>
        {{#if this.glyph}}<StateGlyph @glyph={{this.glyph}} @size={{12}} />{{/if}}
        {{this.text}}
      </span>
      {{#if this.canDiscard}}
        <button type='button' class='pretui-savebar-act' data-kind='quiet' data-test-pretui-save-bar-discard {{on 'click' this.discard}}>Discard</button>
      {{/if}}
      {{#if @onSave}}
        <button
          type='button'
          class='pretui-savebar-act'
          data-kind='primary'
          disabled={{if this.canSave false true}}
          aria-busy={{if this.saving 'true'}}
          data-test-pretui-save-bar-save
          {{on 'click' this.save}}
        >{{if this.saving 'Saving…' 'Save'}}</button>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-savebar {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 40px;
          padding: 0 8px 0 12px;
          box-shadow: 0 -1px 0 var(--border);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-savebar-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          margin-inline-end: auto;
        }
        .pretui-savebar[data-state='dirty'] .pretui-savebar-status {
          color: var(--foreground);
        }
        .pretui-savebar[data-state='saved'] .pretui-savebar-status {
          color: var(--success, var(--boxel-highlight));
        }
        .pretui-savebar[data-state='error'] .pretui-savebar-status {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-savebar-act {
          height: 26px;
          padding: 0 12px;
          border: 0;
          border-radius: 13px;
          background: none;
          font: inherit;
          font-weight: 500;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-savebar-act[data-kind='primary'] {
          background: var(--primary, var(--boxel-highlight));
          color: var(--primary-foreground, var(--boxel-dark));
        }
        .pretui-savebar-act:disabled {
          opacity: 0.45;
          cursor: default;
        }
        .pretui-savebar-act[data-kind='quiet']:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-savebar-act:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
      }
    </style>
  </template>
}
