// Pretui — JsonEditor usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { JsonEditor } from './json-editor';
import { SAMPLE } from '../demo-json';

class JsonEditorUsage extends Component {
  @tracked label = 'Order SO-4471';
  @tracked query = '';
  @tracked readonlyMode = false;
  @tracked indent = 2;
  @tracked emitted = '';
  @tracked issue = '';
  @tracked edits = 0;

  setLabel = (v: string) => (this.label = v);
  setQuery = (v: string) => (this.query = v);
  setReadonly = (v: boolean) => (this.readonlyMode = v);
  setIndent = (v: number) => (this.indent = v);

  json = SAMPLE;

  onChange = (json: string) => {
    this.emitted = json;
    this.issue = '';
    this.edits = this.edits + 1;
  };
  onIssue = (diagnostics: ReadonlyArray<{ message: string }>) => {
    this.issue = diagnostics[0]?.message ?? '';
  };

  get emittedPreview(): string {
    if (this.emitted === '') {
      return 'nothing emitted yet — @onChange only fires for a VALID document';
    }
    return this.emitted.length > 400 ? this.emitted.slice(0, 400) + '…' : this.emitted;
  }
  get editLabel(): string {
    return this.edits === 1 ? '1 committed edit' : String(this.edits) + ' committed edits';
  }

  get usage(): string {
    const bits = ['@json={{this.json}}', `@label='${this.label}'`, '@expandAll={{true}}'];
    if (this.query !== '') {
      bits.push(`@query='${this.query}'`);
    }
    if (this.indent !== 2) {
      bits.push(`@indent={{${this.indent}}}`);
    }
    if (this.readonlyMode) {
      bits.push('@readonly={{true}}');
    }
    bits.push('@onChange={{this.onChange}}');
    bits.push('@onIssue={{this.onIssue}}');
    return `<JsonEditor\n  ${bits.join('\n  ')}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='JsonEditor'
      @description='Structural JSON editing as a WAI-ARIA treegrid, with every
      control a Pretui control. Focus a row and press Enter or F2 to enter edit
      mode: the property name becomes an Input, the type becomes a Select over
      all six JSON types, and the value becomes an Input or a Checkbox. Escape
      returns to row navigation — that two-mode split is the treegrid contract,
      and without it the arrow keys inside a text box would move the selection.
      Alt+Up/Down reorders, Delete removes, Ctrl/Cmd+Z undoes and
      Ctrl/Cmd+Shift+Z redoes. The rules that matter: clearing a string yields
      an empty string and NEVER deletes the property (removal is only ever the
      explicit × button); a value that cannot be read as its type is held as a
      pending draft with the keystrokes intact and an error on the control,
      while the document keeps its last good value; renaming onto an existing
      key is refused with a reason rather than silently overwriting it; and a
      type change that cannot preserve the content says so and stays on the
      undo stack. @onChange therefore ALWAYS carries a valid document, so a
      caller can persist it unconditionally, and everything else arrives on
      @onIssue for the caller to render. Honest limits: reordering is buttons
      and keys, not drag-and-drop; there is no raw-text editing pane, so a
      document is edited structurally rather than typed; and the editor takes
      ownership of the document after the first edit — later changes to @json
      do not reset it.'
      @source={{this.usage}}
    >
      <:example>
        <div class='jd-stack'>
          <JsonEditor
            @json={{this.json}}
            @label={{this.label}}
            @expandAll={{true}}
            @query={{this.query}}
            @indent={{this.indent}}
            @readonly={{this.readonlyMode}}
            @onChange={{this.onChange}}
            @onIssue={{this.onIssue}}
          />
          <div class='jd-out'>
            <p class='jd-readout'>{{this.editLabel}}</p>
            {{#if this.issue}}
              <p class='jd-issue'>
                <span class='jd-issue-mark' aria-hidden='true'>!</span>
                {{this.issue}}
              </p>
            {{/if}}
            <pre class='jd-emitted'>{{this.emittedPreview}}</pre>
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='json'
          @value={{this.json}}
          @description='Starting document as text. Parsed once; the editor owns
          it from the first edit onward.'
          @hideControls={{true}}
        />
        <Args.Object
          @name='value'
          @description='Starting document as a plain JavaScript value.'
          @hideControls={{true}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='JSON editor'
          @description='Accessible name for the grid.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='query'
          @value={{this.query}}
          @description='Case-insensitive filter over property names and values.'
          @onInput={{this.setQuery}}
        />
        <Args.Number
          @name='indent'
          @value={{this.indent}}
          @min={{0}}
          @max={{8}}
          @step={{1}}
          @defaultValue={{2}}
          @description='Spaces per level in the emitted text; 0 is compact.'
          @onInput={{this.setIndent}}
        />
        <Args.Bool
          @name='readonly'
          @value={{this.readonlyMode}}
          @defaultValue={{false}}
          @description='Nothing can be edited; the grid still navigates,
          expands and copies, and reports aria-readonly.'
          @onInput={{this.setReadonly}}
        />
        <Args.Number
          @name='pageSize'
          @defaultValue={{100}}
          @description='Children rendered per container before truncating.'
          @hideControls={{true}}
        />
        <Args.Number
          @name='historyLimit'
          @defaultValue={{200}}
          @description='Undo depth. Each step is one pointer, not a deep clone,
          because every edit returns a structurally shared root.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onChange'
          @description='Fires after every committed edit with the serialised
          text and the plain value. Never fires for a pending or rejected edit.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onIssue'
          @description='Fires when an edit is rejected or degraded — an
          unreadable number, a duplicate property name, a lossy type change.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .jd-stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-3, 8px);
      }
      .jd-out {
        display: flex;
        flex-direction: column;
        gap: var(--space-2, 6px);
      }
      .jd-readout {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .jd-issue {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2, 6px);
        margin: 0;
        padding: var(--space-2, 6px) var(--space-3, 8px);
        border-radius: var(--radius-chip, 6px);
        font-size: var(--text-ui-sm, 11.5px);
        background: color-mix(in oklch, var(--destructive) 10%, transparent);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }
      .jd-issue-mark {
        font-weight: 700;
      }
      .jd-emitted {
        margin: 0;
        padding: var(--space-2, 6px) var(--space-3, 8px);
        border-radius: var(--radius-chip, 6px);
        background: var(--inset, var(--boxel-100));
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        max-height: 140px;
        overflow: auto;
        white-space: pre;
      }
    </style>
  </template>
}

export const DEMOS_JSON_EDITOR: Record<string, unknown> = {
  JsonEditor: JsonEditorUsage,
};
