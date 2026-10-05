// Pretui — FormFooter usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { FormFooter } from './form-footer';
import type { FormIssue } from '../internal/forms-core';

// ── FormFooter ───────────────────────────────────────────────────────────
const FOOTER_ISSUES: FormIssue[] = [
  {
    ruleId: 'opp-close-date',
    targetPath: 'Close Date',
    severity: 'error',
    message: 'Close date must fall inside the open fiscal quarter.',
  },
  {
    ruleId: 'opp-amount-approval',
    targetPath: 'Amount',
    severity: 'error',
    message: 'Deals above $250,000 need a second approver on the record.',
  },
];

class FormFooterUsage extends Component {
  @tracked count = 3;
  @tracked saving = false;
  @tracked disabled = false;
  @tracked dock = 'sticky';
  @tracked hasErrors = false;
  @tracked saveLabel = 'Save';
  @tracked cancelLabel = 'Cancel';
  @tracked log = '';

  setCount = (v: number) => (this.count = v);
  setSaving = (v: boolean) => (this.saving = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setDock = (v: string) => (this.dock = v);
  setHasErrors = (v: boolean) => (this.hasErrors = v);
  setSaveLabel = (v: string) => (this.saveLabel = v);
  setCancelLabel = (v: string) => (this.cancelLabel = v);

  get dockMode(): 'sticky' | 'static' {
    return this.dock === 'static' ? 'static' : 'sticky';
  }
  get issues(): FormIssue[] {
    return this.hasErrors ? FOOTER_ISSUES : [];
  }
  get dockOptions() {
    return ['sticky', 'static'];
  }
  onSave = () => (this.log = `Saved ${this.count}.`);
  onCancel = () => (this.log = 'Discarded.');

  get usage() {
    return [
      `<FormFooter`,
      `  @count={{${this.count}}}`,
      `  @dock='${this.dockMode}'`,
      `  @issues={{this.issues}}`,
      `  @saving={{${this.saving}}}`,
      `  @onSave={{this.onSave}}`,
      `  @onCancel={{this.onCancel}} />`,
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='FormFooter'
      @description="The docked save/cancel bar for a batched form — SLDS's docked-form-footer, cut to stay inside a card. Reach for it whenever edits accumulate before a single commit: RecordDetail renders one automatically, and you can dock your own anywhere else from its yielded state. It states the count of unsaved changes in an aria-live region (SLDS shows no count at all), disables Save while any blocking issue stands, and points Save's aria-describedby at the reason. The upstream is position: fixed, which escapes a card's bounding box and is lint-flagged in this codebase — this one is position: sticky, so it docks to the bottom of the form's own scroll container instead. Scroll the frame below to watch it hold. Limit: sticky needs a scrolling ancestor; with none, @dock='static' is the honest choice."
      @source={{this.usage}}
    >
      <:example>
        <div class='ff-frame'>
          <div class='ff-scroll'>
            <div class='ff-filler'>
              <p>Opportunity — spring first-flush allocation. Scroll to see the
                bar stay docked to the bottom of THIS frame rather than the
                browser window.</p>
              <p>Stage: Negotiation. Amount: $312,400. Close date: 2026-05-07.</p>
              <p>Line items: Silver Needle, Da Hong Pao, Gyokuro, Milk Oolong,
                White Peony, Jasmine Dragon Pearls.</p>
              <p>Every batched edit above would be counted by the bar below.</p>
              <p>Keep scrolling.</p>
              <p>And a little more.</p>
            </div>
            <FormFooter
              @count={{this.count}}
              @issues={{this.issues}}
              @saving={{this.saving}}
              @disabled={{this.disabled}}
              @dock={{this.dockMode}}
              @saveLabel={{this.saveLabel}}
              @cancelLabel={{this.cancelLabel}}
              @onSave={{this.onSave}}
              @onCancel={{this.onCancel}}
            />
          </div>
        </div>
        {{#if this.log}}
          <p class='ff-log'>{{this.log}}</p>
        {{/if}}
      </:example>

      <:api as |Args|>
        <Args.Number
          @name='count'
          @value={{this.count}}
          @min={{0}}
          @max={{12}}
          @step={{1}}
          @defaultValue={{0}}
          @description='Fields carrying a committed-but-unsaved edit. Drives the live status sentence and enables Save; at zero the bar still renders, reading “No unsaved changes”, so nothing jumps when the first edit lands.'
          @onInput={{this.setCount}}
        />
        <Args.Bool
          @name='issues'
          @value={{this.hasErrors}}
          @defaultValue={{false}}
          @description='Injects two blocking issues. Blocking severity — “error”, or anything unrecognised — disables Save and is counted in the status line. The footer never evaluates anything.'
          @onInput={{this.setHasErrors}}
        />
        <Args.Bool
          @name='saving'
          @value={{this.saving}}
          @defaultValue={{false}}
          @description='Save is in flight: the button goes busy and both actions lock.'
          @onInput={{this.setSaving}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Hard-disables Save regardless of count — a permission gate, say.'
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='dock'
          @value={{this.dock}}
          @options={{this.dockOptions}}
          @defaultValue='sticky'
          @description="'sticky' docks to the bottom of the nearest scroll container; 'static' leaves the bar in normal flow. Never fixed — a card must not paint outside its own box."
          @onInput={{this.setDock}}
        />
        <Args.String
          @name='saveLabel'
          @value={{this.saveLabel}}
          @defaultValue='Save'
          @description='Label for the commit action.'
          @onInput={{this.setSaveLabel}}
        />
        <Args.String
          @name='cancelLabel'
          @value={{this.cancelLabel}}
          @defaultValue='Cancel'
          @description='Label for the discard action.'
          @onInput={{this.setCancelLabel}}
        />
        <Args.Action
          @name='onSave'
          @description='Invoked when the user commits the batch.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onCancel'
          @description='Invoked when the user discards the batch.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='<:status>'
          @description='Replaces the generated status sentence entirely — for a domain where “3 unsaved changes” is the wrong thing to say, or where the errors should be a click-to-jump list.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='<:actions>'
          @description='Extra actions rendered before Cancel/Save — a “Save & New”, say.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .ff-frame {
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border));
        background: var(--card);
        overflow: hidden;
      }
      .ff-scroll {
        height: 240px;
        overflow: auto;
        display: flex;
        flex-direction: column;
      }
      .ff-filler {
        flex: 1 0 auto;
        padding: var(--space-5, 14px);
        display: grid;
        gap: var(--space-4, 11px);
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
      .ff-filler p {
        margin: 0;
      }
      .ff-log {
        margin: var(--space-3, 8px) 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_FORM_FOOTER: Record<string, unknown> = {
  FormFooter: FormFooterUsage,
};
