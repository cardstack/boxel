// Pretui — Form usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Input } from './input';
import { Select } from './select';
import { Form } from './form';
import type { FormApi } from './form';
import type { FormIssue, FormMode } from '../internal/forms-core';
import { ACCOUNT_ISSUES, OWNERS, RATINGS } from '../demo-forms-core';

// ── Form ─────────────────────────────────────────────────────────────────
const MODES = ['submit', 'live', 'record'];

const FOCUS_TARGETS = ['field', 'summary', 'none'];

// Dropped from React Spectrum's <Form>: @validationErrors (a server-error
// map keyed by input NAME — our issues are keyed by BXL label path, which is
// the stable identifier the rules already speak), and the whole
// FormValidationContext machinery, because Pretui never validates. Dropped
// from SLDS: nothing — `slds-form` is only a layout class, and that is
// FormLayout's job.
class FormUsage extends Component {
  modeOptions = MODES;
  focusOptions = FOCUS_TARGETS;

  @tracked mode = 'submit';
  @tracked withIssues = true;
  @tracked disabled = false;
  @tracked busy = false;
  @tracked focusOnInvalid = 'field';
  @tracked lastEvent = 'nothing yet';

  // Account record, tea-trade data. Website is empty on purpose — that is
  // the error the guide rule reports.
  @tracked accountName = 'Wuyi Origins';
  @tracked website = '';
  @tracked owner = 'mei-lin';
  @tracked rating = 'hot';

  setMode = (v: string) => (this.mode = v);
  setWithIssues = (v: boolean) => (this.withIssues = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setBusy = (v: boolean) => (this.busy = v);
  setFocus = (v: string) => (this.focusOnInvalid = v);
  setAccountName = (v: string) => (this.accountName = v);
  setWebsite = (v: string) => (this.website = v);
  setOwner = (v: string) => (this.owner = v);
  setRating = (v: string) => (this.rating = v);

  get modeVal() {
    return this.mode as FormMode;
  }
  get focusVal() {
    return this.focusOnInvalid as 'field' | 'summary' | 'none';
  }
  get issues(): FormIssue[] {
    return this.withIssues ? ACCOUNT_ISSUES : [];
  }
  get ownerLabel() {
    return OWNERS.find((o) => o.value === this.owner)?.label ?? '—';
  }
  get ratingLabel() {
    return RATINGS.find((o) => o.value === this.rating)?.label ?? '—';
  }
  get isRecord() {
    return this.mode === 'record';
  }
  get saveLabel() {
    return this.isRecord ? 'Save record' : 'Submit for approval';
  }

  handleSubmit = () => {
    this.lastEvent = 'onSubmit — the gate passed and the commit ran';
  };
  handleInvalid = (issues: FormIssue[]) => {
    this.lastEvent = `onInvalidSubmit — refused with ${issues.length} blocking issue(s); focus moved`;
  };
  handleReset = () => {
    this.lastEvent = 'onReset — dirty and submit-attempted cleared';
  };
  stateLine = (api: FormApi) =>
    `${api.dirty ? 'dirty' : 'pristine'} · ${api.submitted ? 'submit attempted' : 'not yet submitted'} · ${api.blockingIssues.length} blocking`;

  get usage() {
    let bits = [`@mode='${this.mode}'`, '@issues={{this.issues}}'];
    if (this.disabled) bits.push('@disabled={{true}}');
    if (this.busy) bits.push('@busy={{true}}');
    if (this.focusOnInvalid !== 'field')
      bits.push(`@focusOnInvalid='${this.focusOnInvalid}'`);
    bits.push('@onSubmit={{this.save}}');
    return `<Form ${bits.join(' ')}>\n  <:default as |form|>\n    <form.Summary />\n    <form.Layout @columns={{2}} as |grid|>\n      <grid.Field @label='Website' @path='Website' @required={{true}}>\n        <:control as |c|>\n          <Input @controlId={{c.id}} aria-describedby={{c.describedBy}} … />\n        </:control>\n      </grid.Field>\n    </form.Layout>\n  </:default>\n  <:footer as |form|>\n    <Button type='submit' @busy={{form.busy}}>Save</Button>\n  </:footer>\n</Form>`;
  }

  <template>
    <FreestyleUsage
      @name='Form'
      @description="The form host, in three commit models, because a Boxel card autosaves and has no submit. 'submit' is the React Spectrum classic — errors are withheld until the user tries to commit, then the first invalid field takes focus. 'live' commits per field and treats issues as ambient advice that never gates. 'record' is the Salesforce record page: fields rest as static text, edits batch, and the footer docks. It composes FormLayout, FormField, FieldError and ErrorSummary and yields all four pre-bound. It never validates anything — hand it the FormIssue[] a BXL guide-rule run produced. Honest limit: because it takes a <:footer> named block, a body written alongside it must be an explicit <:default>."
      @source={{this.usage}}
    >
      <:example>
        <Form
          @mode={{this.modeVal}}
          @issues={{this.issues}}
          @disabled={{this.disabled}}
          @busy={{this.busy}}
          @focusOnInvalid={{this.focusVal}}
          @label='Account — Wuyi Origins'
          @onSubmit={{this.handleSubmit}}
          @onInvalidSubmit={{this.handleInvalid}}
          @onReset={{this.handleReset}}
        >
          <:default as |form|>
            <form.Summary />
            <form.Layout @columns={{2}} as |grid|>
              <grid.Field
                @label='Account Name'
                @path='Name'
                @required={{true}}
                @static={{this.isRecord}}
                @value={{this.accountName}}
              >
                <:control as |c|>
                  <Input
                    @controlId={{c.id}}
                    @value={{this.accountName}}
                    @disabled={{c.disabled}}
                    @onInput={{this.setAccountName}}
                    aria-describedby={{c.describedBy}}
                    aria-invalid={{if c.invalid 'true'}}
                  />
                </:control>
              </grid.Field>
              <grid.Field
                @label='Website'
                @path='Website'
                @required={{true}}
                @static={{this.isRecord}}
                @value={{this.website}}
                @description='Used by the purchasing approval rule.'
                @help='Supplier accounts cannot clear approval without a public web presence.'
              >
                <:control as |c|>
                  <Input
                    @controlId={{c.id}}
                    @value={{this.website}}
                    @placeholder='https://'
                    @disabled={{c.disabled}}
                    @onInput={{this.setWebsite}}
                    aria-describedby={{c.describedBy}}
                    aria-invalid={{if c.invalid 'true'}}
                  />
                </:control>
              </grid.Field>
              <grid.Field
                @label='Account Owner'
                @path='"Account Owner"'
                @static={{this.isRecord}}
                @value={{this.ownerLabel}}
              >
                <:control as |c|>
                  <Select
                    @controlId={{c.id}}
                    @options={{this.ownerOptions}}
                    @value={{this.owner}}
                    @disabled={{c.disabled}}
                    @onValueChange={{this.setOwner}}
                  />
                </:control>
              </grid.Field>
              <grid.Field
                @label='Rating'
                @path='Rating'
                @static={{this.isRecord}}
                @value={{this.ratingLabel}}
              >
                <:control as |c|>
                  <Select
                    @controlId={{c.id}}
                    @options={{this.ratingOptions}}
                    @value={{this.rating}}
                    @disabled={{c.disabled}}
                    @onValueChange={{this.setRating}}
                  />
                </:control>
              </grid.Field>
            </form.Layout>
          </:default>
          <:footer as |form|>
            <span class='demo-forms-state'>{{this.stateLine form}}</span>
            <Button @variant='ghost' type='reset' @disabled={{form.busy}}>
              Cancel
            </Button>
            <Button type='submit' @busy={{form.busy}}>{{this.saveLabel}}</Button>
          </:footer>
        </Form>
        <p class='demo-forms-readout'>{{this.lastEvent}}</p>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='mode'
          @defaultValue='submit'
          @value={{this.mode}}
          @options={{this.modeOptions}}
          @description="Commit model. 'submit' gates and focuses on failure; 'live' never gates; 'record' gates and docks the footer, and is what a Salesforce record page runs."
          @onInput={{this.setMode}}
        />
        <Args.Bool
          @name='withIssues'
          @defaultValue={{true}}
          @value={{this.withIssues}}
          @description='Demo knob: swaps the FormIssue[] between a realistic guide-rule result and an empty list. Submit with issues on to watch focus land on Website.'
          @onInput={{this.setWithIssues}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @description='Disables every field at once — travels down the context, so fields do not each need the flag.'
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='busy'
          @defaultValue={{false}}
          @value={{this.busy}}
          @description='A commit is in flight: sets aria-busy, stops the body taking input, and refuses re-submission.'
          @onInput={{this.setBusy}}
        />
        <Args.String
          @name='focusOnInvalid'
          @defaultValue='field'
          @value={{this.focusOnInvalid}}
          @options={{this.focusOptions}}
          @description="Where focus lands on a refused commit. 'field' is React Spectrum's first-invalid-field; 'summary' is the GOV.UK error-summary behavior; 'none' leaves focus alone. Either way an unroutable issue falls back to the summary."
          @onInput={{this.setFocus}}
        />
        <Args.Object
          @name='issues'
          @description='The already-computed FormIssue[] — { targetPath, severity, message, ruleId? }. Produced by a BXL guide-rule evaluation elsewhere; the component never evaluates, parses, or splits anything.'
        />
        <Args.String
          @name='validationBehavior'
          @defaultValue='aria'
          @description="React Spectrum's switch, same names. 'aria' (default) adds novalidate so the browser's own bubbles never race ours; 'native' leaves native constraint validation on."
        />
        <Args.String
          @name='label'
          @description='Accessible name for the form landmark.'
        />
        <Args.String
          @name='labelledBy'
          @description='id of an existing heading that names the form, instead of @label.'
        />
        <Args.Action
          @name='onSubmit'
          @description='Fires only when the gate passed. Never fires while @busy.'
        />
        <Args.Action
          @name='onInvalidSubmit'
          @description='Receives the blocking issues when a commit is refused — hook for a toast or a telemetry ping.'
        />
        <Args.Action
          @name='onReset'
          @description='Fires on the native reset; dirty and submit-attempted are cleared first.'
        />
        <Args.Yield
          @name='default'
          @description='The body. Receives the API: Field, Layout, Summary, Error, context, mode, issues, blockingIssues, unroutedIssues, dirty, pristine, submitted, disabled, busy, submit, reset, markDirty, markPristine.'
        />
        <Args.Yield
          @name='footer'
          @description='Action bar, receiving the same API. Docks (sticky, never viewport-fixed) in record mode.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='--pretui-form-gap'
          @value='var(--space-5, 14px)'
          @description='Vertical rhythm between the form body sections.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .demo-forms-state {
        margin-right: auto;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .demo-forms-readout {
        margin: 10px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>

  ownerOptions = OWNERS;
  ratingOptions = RATINGS;
}

export const DEMOS_FORM: Record<string, unknown> = {
  Form: FormUsage,
};
