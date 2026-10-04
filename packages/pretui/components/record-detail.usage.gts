// Pretui — RecordDetail usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { RecordDetail } from './record-detail';
import { Input } from './input';
import { Select } from './select';
import { Textarea } from './textarea';
import { PhoneInput } from './phone-input';
import { UrlInput } from './url-input';
import {
  PEOPLE,
  PLACES,
  SUPPLIERS,
  pick,
} from '../examples';
import type { FormIssue } from '../internal/forms-core';
import { SEED, asOptions, str } from '../demo-forms-record';

// ── RecordDetail ─────────────────────────────────────────────────────────
const OWNER = pick(SEED, 0, PEOPLE);

const SUPPLIER = pick(SEED, 1, SUPPLIERS);

const ORIGIN = pick(SEED, 2, PLACES);

const ACCOUNT_PATHS = {
  name: 'Account Name',
  owner: 'Account Owner',
  type: 'Type',
  industry: 'Industry',
  revenue: 'Annual Revenue',
  phone: 'Phone',
  website: 'Website',
  origin: 'Primary Origin',
  description: 'Description',
};

const KEY_BY_PATH: Record<string, string> = {
  'Account Name': 'name',
  'Account Owner': 'owner',
  Type: 'type',
  Industry: 'industry',
  'Annual Revenue': 'revenue',
  Phone: 'phone',
  Website: 'website',
  'Primary Origin': 'origin',
  Description: 'description',
};

interface AccountRecord {
  name: string;
  owner: string;
  type: string;
  industry: string;
  revenue: string;
  phone: string;
  website: string;
  origin: string;
  description: string;
}

const ACCOUNT: AccountRecord = {
  name: SUPPLIER,
  owner: OWNER,
  type: 'Customer — Direct',
  industry: 'Food & Beverage',
  revenue: '$12,480,000',
  phone: '+86 599 5312 884',
  website: 'https://silverpeak.example/trade',
  origin: ORIGIN,
  description:
    'Long-standing first-flush partner. Books the spring lot twelve weeks ' +
    'ahead and ships through the maritime consolidator; cupping notes are ' +
    'filed against every batch before the invoice clears.',
};

const OWNER_OPTIONS = asOptions(PEOPLE);

const ORIGIN_OPTIONS = asOptions(PLACES);

const TYPE_OPTIONS = asOptions([
  'Customer — Direct',
  'Customer — Channel',
  'Prospect',
  'Reseller',
  'Supplier',
]);

const INDUSTRY_OPTIONS = asOptions([
  'Food & Beverage',
  'Agriculture',
  'Hospitality',
  'Retail',
  'Logistics',
]);

/** Already-computed BXL guide output. Note the fourth one: its targetPath is
 *  a PREDICATE path against a line item that this record page does not
 *  render. It must still reach the reader — that is what the form-level
 *  summary is for, and why nothing here ever splits a path on '.'. */

const ACCOUNT_ISSUES: FormIssue[] = [
  {
    ruleId: 'acct-owner-required',
    targetPath: 'Account Owner',
    severity: 'error',
    message: 'An account cannot be saved without a named owner.',
  },
  {
    ruleId: 'acct-revenue-tier',
    targetPath: 'Annual Revenue',
    severity: 'warning',
    message:
      'Revenue above $10M moves this account into the enterprise tier — ' +
      'confirm the banding with finance before the quarter closes.',
  },
  {
    ruleId: 'acct-origin-advisory',
    targetPath: 'Primary Origin',
    severity: 'info',
    message: 'Origin drives the customs template on every shipment.',
  },
  {
    ruleId: 'line-quantity-rounded',
    targetPath: '"Line Item"[SKU = "DHP-04"].Quantity',
    severity: 'critical',
    message:
      'Da Hong Pao line DHP-04: quantity exceeds the reserved allocation. ' +
      "(Unrecognised severity 'critical' — treated as blocking, fail closed.)",
  },
];

class RecordDetailUsage extends Component {
  @tracked account: AccountRecord = { ...ACCOUNT };
  @tracked columns = 2;
  @tracked layout = 'stacked';
  @tracked readOnly = false;
  @tracked showIssues = false;
  @tracked summary = true;
  @tracked hideFooter = false;
  @tracked lastSave = '';

  setColumns = (v: number) => (this.columns = v);
  setLayout = (v: string) => (this.layout = v);
  setReadOnly = (v: boolean) => (this.readOnly = v);
  setShowIssues = (v: boolean) => (this.showIssues = v);
  setSummary = (v: boolean) => (this.summary = v);
  setHideFooter = (v: boolean) => (this.hideFooter = v);

  get layoutMode(): 'stacked' | 'horizontal' {
    return this.layout === 'horizontal' ? 'horizontal' : 'stacked';
  }
  get layoutOptions() {
    return ['stacked', 'horizontal'];
  }
  get issues(): FormIssue[] {
    return this.showIssues ? ACCOUNT_ISSUES : [];
  }
  get paths() {
    return ACCOUNT_PATHS;
  }
  get ownerOptions() {
    return OWNER_OPTIONS;
  }
  get typeOptions() {
    return TYPE_OPTIONS;
  }
  get industryOptions() {
    return INDUSTRY_OPTIONS;
  }
  get originOptions() {
    return ORIGIN_OPTIONS;
  }

  /** The host's half of the contract: the batch arrives as
   *  `{ [labelPath]: value }`, the host writes it, and the record's `@value`s
   *  come back changed. RecordDetail never mutates what it was handed. */
  applySave = (changes: Record<string, unknown>) => {
    let next = { ...this.account } as Record<string, unknown>;
    let wrote: string[] = [];
    for (let path of Object.keys(changes)) {
      let key = KEY_BY_PATH[path];
      if (key) {
        next[key] = changes[path];
        wrote.push(path);
      }
    }
    this.account = next as unknown as AccountRecord;
    this.lastSave = wrote.length
      ? `Wrote ${wrote.length}: ${wrote.join(', ')}`
      : 'Nothing to write.';
  };
  noteCancel = () => {
    this.lastSave = 'Batch discarded — every field back to its saved value.';
  };

  get usage() {
    return [
      `<RecordDetail @columns={{${this.columns}}} @layout='${this.layoutMode}'`,
      `  @issues={{this.issues}} @onSave={{this.applySave}} as |R|>`,
      `  <R.Field @path='Account Name' @label='Account Name'`,
      `    @value={{this.account.name}} @required={{true}}>`,
      `    <:editor as |E|>`,
      `      <Input @value={{str E.value}} @controlId={{E.controlId}}`,
      `        @invalid={{E.invalid}} @onInput={{E.set}} {{E.focus true}} />`,
      `    </:editor>`,
      `  </R.Field>`,
      `</RecordDetail>`,
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='RecordDetail'
      @description="The Salesforce record page, and the reason this territory exists. Every field renders as static text; clicking it (or pressing Enter on it) reveals the editor IN PLACE; an undo reverts that one field; and a docked footer saves the whole batch at once. Reach for it whenever a card mirrors a CRM-shaped record — Boxel cards autosave and have no submit, so per-field inline edit with a batched commit is the honest fit where a submit-form is not. It composes anything as its editor: the <:editor> block is a slot, so Input, Select, Textarea, a date picker or your own control all work, and RecordDetail itself knows about none of them. It never validates — hand it already-computed FormIssues from BXL guide rules and it routes them by whole-string targetPath. Limits: the issue summary lists every issue rather than only the unrouted ones (knowing which paths rendered would need render-phase registration, which Ember asserts on), and one editor is open at a time by design."
      @source={{this.usage}}
    >
      <:example>
        <div class='rd-stage'>
          <RecordDetail
            @columns={{this.columns}}
            @layout={{this.layoutMode}}
            @readOnly={{this.readOnly}}
            @issues={{this.issues}}
            @summary={{this.summary}}
            @hideFooter={{this.hideFooter}}
            @onSave={{this.applySave}}
            @onCancel={{this.noteCancel}}
            as |R|
          >
            <R.Field
              @path={{this.paths.name}}
              @label='Account Name'
              @value={{this.account.name}}
              @required={{true}}
              @help='The legal trading name as it appears on the invoice.'
            >
              <:editor as |E|>
                <Input
                  @value={{str E.value}}
                  @controlId={{E.controlId}}
                  @invalid={{E.invalid}}
                  @onInput={{E.set}}
                  {{E.focus true}}
                />
              </:editor>
            </R.Field>

            <R.Field
              @path={{this.paths.owner}}
              @label='Account Owner'
              @value={{this.account.owner}}
              @required={{true}}
            >
              <:editor as |E|>
                <Select
                  @options={{this.ownerOptions}}
                  @value={{str E.value}}
                  @controlId={{E.controlId}}
                  @onValueChange={{E.set}}
                />
              </:editor>
            </R.Field>

            <R.Field
              @path={{this.paths.type}}
              @label='Type'
              @value={{this.account.type}}
            >
              <:editor as |E|>
                <Select
                  @options={{this.typeOptions}}
                  @value={{str E.value}}
                  @controlId={{E.controlId}}
                  @onValueChange={{E.set}}
                />
              </:editor>
            </R.Field>

            <R.Field
              @path={{this.paths.industry}}
              @label='Industry'
              @value={{this.account.industry}}
            >
              <:editor as |E|>
                <Select
                  @options={{this.industryOptions}}
                  @value={{str E.value}}
                  @controlId={{E.controlId}}
                  @onValueChange={{E.set}}
                />
              </:editor>
            </R.Field>

            <R.Field
              @path={{this.paths.revenue}}
              @label='Annual Revenue'
              @value={{this.account.revenue}}
            >
              <:editor as |E|>
                <Input
                  @value={{str E.value}}
                  @controlId={{E.controlId}}
                  @invalid={{E.invalid}}
                  @onInput={{E.set}}
                  {{E.focus true}}
                />
              </:editor>
            </R.Field>

            <R.Field
              @path={{this.paths.origin}}
              @label='Primary Origin'
              @value={{this.account.origin}}
            >
              <:editor as |E|>
                <Select
                  @options={{this.originOptions}}
                  @value={{str E.value}}
                  @controlId={{E.controlId}}
                  @onValueChange={{E.set}}
                />
              </:editor>
            </R.Field>

            <R.Field
              @path={{this.paths.phone}}
              @label='Phone'
              @value={{this.account.phone}}
            >
              <:editor as |E|>
                {{! PhoneInput/UrlInput own their own validation dress, so
                    they take no @invalid — the issue message still renders
                    under the field. }}
                <PhoneInput
                  @value={{str E.value}}
                  @controlId={{E.controlId}}
                  @onInput={{E.set}}
                  {{E.focus true}}
                />
              </:editor>
            </R.Field>

            <R.Field
              @path={{this.paths.website}}
              @label='Website'
              @value={{this.account.website}}
            >
              <:display as |value|>
                <span class='rd-link'>{{str value}}</span>
              </:display>
              <:editor as |E|>
                <UrlInput
                  @value={{str E.value}}
                  @controlId={{E.controlId}}
                  @onInput={{E.set}}
                  {{E.focus true}}
                />
              </:editor>
            </R.Field>

            <R.Field
              @path={{this.paths.description}}
              @label='Description'
              @value={{this.account.description}}
              @longform={{true}}
              @span='full'
            >
              <:editor as |E|>
                <Textarea
                  @value={{str E.value}}
                  @controlId={{E.controlId}}
                  @invalid={{E.invalid}}
                  @onInput={{E.set}}
                  {{E.focus true}}
                />
              </:editor>
            </R.Field>

            {{! No <:editor> block at all: read-only, and it says so
                structurally rather than by flag. }}
            <R.Field
              @path='Record Type'
              @label='Record Type'
              @value='Trade Partner'
            />
          </RecordDetail>

          {{#if this.lastSave}}
            <p class='rd-log' data-test-pretui-demo-savelog>{{this.lastSave}}</p>
          {{/if}}
        </div>
      </:example>

      <:api as |Args|>
        <Args.Number
          @name='columns'
          @value={{this.columns}}
          @min={{1}}
          @max={{4}}
          @step={{1}}
          @defaultValue={{2}}
          @description='Columns at full width, clamped to 1–4. Folds to two below 52rem and to one below 32rem — real container queries measured on the record, not the viewport.'
          @onInput={{this.setColumns}}
        />
        <Args.String
          @name='layout'
          @value={{this.layout}}
          @options={{this.layoutOptions}}
          @defaultValue='stacked'
          @description="'stacked' puts each label above its value (the Salesforce default); 'horizontal' puts it beside, folding back to stacked when the field itself gets narrow."
          @onInput={{this.setLayout}}
        />
        <Args.Bool
          @name='readOnly'
          @value={{this.readOnly}}
          @defaultValue={{false}}
          @description='Turns every field read-only at once — no pencils anywhere. A single field opts out with its own @readOnly, or simply by omitting its <:editor> block.'
          @onInput={{this.setReadOnly}}
        />
        <Args.Bool
          @name='issues'
          @value={{this.showIssues}}
          @defaultValue={{false}}
          @description="Injects four already-computed guide issues: a blocking one on Account Owner, a warning on Annual Revenue, an info note on Primary Origin, and one with an unrecognised severity ('critical') on a PREDICATE path that this page does not render — it fails closed to blocking and can only surface in the summary."
          @onInput={{this.setShowIssues}}
        />
        <Args.Bool
          @name='summary'
          @value={{this.summary}}
          @defaultValue={{true}}
          @description='The form-level issue list above the grid. It is complete rather than residual — that is what guarantees an issue targeting no rendered field is never swallowed.'
          @onInput={{this.setSummary}}
        />
        <Args.Bool
          @name='hideFooter'
          @value={{this.hideFooter}}
          @defaultValue={{false}}
          @description='Suppresses the built-in docked FormFooter. Drive your own from the yielded state instead.'
          @onInput={{this.setHideFooter}}
        />
        <Args.String
          @name='placeholder'
          @defaultValue='—'
          @description='Text shown for an empty value; a field can override it.'
          @hideControls={{true}}
        />
        <Args.Bool
          @name='saving'
          @defaultValue={{false}}
          @description='Save is in flight — the footer locks and the Save button goes busy.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onSave'
          @description='Receives the batch as { [labelPath]: value }. The draft clears optimistically the moment it fires; the host writes and hands back new @values.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onCancel'
          @description='Fires after the batch is discarded. A half-typed field goes with it: whether the blur commits it on the way to the Cancel button or not, cancelAll clears the draft either way.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='Yields { Field, Compound, state }. Field and Compound are pre-bound to this record’s batch and issues; state is { dirtyCount, dirtyPaths, editingPath, save, cancel } for a custom footer or a header badge.'
          @hideControls={{true}}
        />
        <Args.String
          @name='Field @path'
          @required={{true}}
          @description='BXL label path. An issue is routed here when its targetPath EQUALS this string — whole-string match, never split on “.”, because predicate paths contain dots, brackets, quotes and spaces.'
          @hideControls={{true}}
        />
        <Args.String
          @name='Field @label'
          @required={{true}}
          @description='Human label. Renders as <label for> while editing and as a plain <span> in view mode — the SLDS distinction, since in view mode there is no control to point at.'
          @hideControls={{true}}
        />
        <Args.Object
          @name='Field @value'
          @description='The SAVED value, a plain value of any shape. RecordDetail holds the pending edit separately and never mutates this — which is the only reason undo has somewhere to go back to.'
          @hideControls={{true}}
        />
        <Args.Bool
          @name='Field @required / @longform / @readOnly'
          @description='Three independent flags. Required adds the asterisk plus an sr-only “(required)”; longform renders the static value as running text (SLDS slds-text-longform); readOnly drops the pencil for this field only.'
          @hideControls={{true}}
        />
        <Args.String
          @name='Field @span'
          @defaultValue='auto'
          @description="'full' spans every column — what the Description field uses here, replacing SLDS's hand-authored slds-form__row wrappers."
          @hideControls={{true}}
        />
        <Args.Yield
          @name='Field <:editor>'
          @description='The editor control, as a named block — never hardcoded. Yields { value, controlId, set, commit, cancel, invalid, focus }. Apply the yielded focus modifier (E.focus, with an explicit true positional) to whichever control should take focus when the editor opens. Omit the block entirely and the field is read-only.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='Field <:display>'
          @description='Custom static rendering, yielding the current value — the avatar, link, Chip or formatted number SLDS spent three separate props on.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .rd-stage {
        display: grid;
        gap: var(--space-3, 8px);
        min-width: 0;
      }
      .rd-link {
        color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .rd-log {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_RECORD_DETAIL: Record<string, unknown> = {
  RecordDetail: RecordDetailUsage,
};
