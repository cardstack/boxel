// Pretui — FormField usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Input } from './input';
import { FormField } from './form-field';
import type { FormIssue } from '../internal/forms-core';
import { LAYOUTS } from '../demo-forms-core';

// ── FormField ────────────────────────────────────────────────────────────
// Dropped from SLDS's form-element:
// `_compound` / `_address` fieldsets, hasLeftIcon / hasRightIcon /
// hasRightIconGroup, `slds-hint-parent` hover-reveal, `dropdown`, and the
// hasHiddenInlineMessage flag (a message you hide from sighted users but
// keep for AT is a message you should not have written).
class FormFieldUsage extends Component {
  layoutOptions = LAYOUTS;

  @tracked label = 'Annual Revenue';
  @tracked path = '"Annual Revenue"';
  @tracked value = '$12,480';
  @tracked description = 'Rolling twelve months, in the account currency.';
  @tracked help = 'Sourced from the ledger nightly; edit only to correct a mis-post.';
  @tracked required = true;
  @tracked disabled = false;
  @tracked readonly = false;
  @tracked isStatic = false;
  @tracked showIssue = true;
  @tracked layout = 'stacked';

  setLabel = (v: string) => (this.label = v);
  setPath = (v: string) => (this.path = v);
  setValue = (v: string) => (this.value = v);
  setDescription = (v: string) => (this.description = v);
  setHelp = (v: string) => (this.help = v);
  setRequired = (v: boolean) => (this.required = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setReadonly = (v: boolean) => (this.readonly = v);
  setStatic = (v: boolean) => (this.isStatic = v);
  setShowIssue = (v: boolean) => (this.showIssue = v);
  setLayout = (v: string) => (this.layout = v);

  get layoutVal() {
    return this.layout as 'stacked' | 'horizontal';
  }
  get issues(): FormIssue[] {
    return this.showIssue
      ? [
          {
            ruleId: 'acct-revenue-band',
            targetPath: this.path,
            severity: 'error',
            message:
              'Annual revenue is 41% above the prior year — a regional buyer has to confirm the band.',
          },
        ]
      : [];
  }
  get usage() {
    let bits = [
      `@label='${this.label}'`,
      `@path='${this.path.replace(/'/g, "\\'")}'`,
      '@issues={{this.issues}}',
    ];
    if (this.required) bits.push('@required={{true}}');
    if (this.disabled) bits.push('@disabled={{true}}');
    if (this.readonly) bits.push('@readonly={{true}}');
    if (this.isStatic) bits.push(`@static={{true}} @value='${this.value}'`);
    if (this.layout !== 'stacked') bits.push(`@layout='${this.layout}'`);
    return `<FormField ${bits.join(' ')}>\n  <:control as |c|>\n    <Input @controlId={{c.id}} aria-describedby={{c.describedBy}}\n      aria-invalid={{if c.invalid 'true'}} @disabled={{c.disabled}} />\n  </:control>\n</FormField>`;
  }

  <template>
    <FreestyleUsage
      @name='FormField'
      @description="The workhorse: SLDS's form-element — label, required marking, help tooltip, description, error region, and the stacked/horizontal label layouts — wearing React Spectrum's describedby semantics. It takes a PLAIN VALUE and a BXL label path, never a FieldDef, and it does not own a control: the control is the <:control> named block, which receives id, describedBy, invalid, required, disabled and readonly so the wiring cannot be forgotten. @readonly flattens the chrome and keeps the value selectable; @static drops the control entirely for a record page's resting state. Honest limits: the label is Pretui's mono eyebrow Label, so it is not restyleable per field, and the help text is mirrored into a visually-hidden node because Tooltip exposes no id to point aria-describedby at."
      @source={{this.usage}}
    >
      <:example>
        <div class='demo-forms-fieldstage'>
          <FormField
            @label={{this.label}}
            @path={{this.path}}
            @value={{this.value}}
            @description={{this.description}}
            @help={{this.help}}
            @required={{this.required}}
            @disabled={{this.disabled}}
            @readonly={{this.readonly}}
            @static={{this.isStatic}}
            @layout={{this.layoutVal}}
            @issues={{this.issues}}
            @showRuleId={{true}}
          >
            <:control as |c|>
              <Input
                @controlId={{c.id}}
                @value={{this.value}}
                @disabled={{c.disabled}}
                @onInput={{this.setValue}}
                aria-describedby={{c.describedBy}}
                aria-invalid={{if c.invalid 'true'}}
                readonly={{c.readonly}}
              />
            </:control>
          </FormField>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @value={{this.label}}
          @description='Visible label, rendered through Pretui Label as a <label for> — or a faux <span> in static display, where there is no control to point at.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='path'
          @value={{this.path}}
          @description='BXL label path. Issues whose targetPath EQUALS this string are picked up — whole-string, never split, because predicate paths contain dots, brackets, quotes and spaces.'
          @onInput={{this.setPath}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @description='The plain scalar, used by the static display. Not a FieldDef; anything richer than a scalar goes in the <:static> block.'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='description'
          @value={{this.description}}
          @description='Persistent helper prose under the control. First in the aria-describedby chain, ahead of any error.'
          @onInput={{this.setDescription}}
        />
        <Args.String
          @name='help'
          @value={{this.help}}
          @description="Field-level help behind an info button — SLDS's __icon, with a guid-unique id instead of its hardcoded id='help'."
          @onInput={{this.setHelp}}
        />
        <Args.Bool
          @name='required'
          @defaultValue={{false}}
          @value={{this.required}}
          @description='Asterisk plus a visually-hidden "(required)" inside the label, so required-ness reaches AT even if the control never took the attribute.'
          @onInput={{this.setRequired}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @description='Not available right now: the field dims and the control is switched off.'
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='readonly'
          @defaultValue={{false}}
          @value={{this.readonly}}
          @description="SLDS `_readonly` — you may not change this. Nothing dims; the chrome flattens through the --field/--input token channel and the control keeps focus."
          @onInput={{this.setReadonly}}
        />
        <Args.Bool
          @name='static'
          @defaultValue={{false}}
          @value={{this.isStatic}}
          @description="SLDS `__static` — no control at all, the value as text under a faux label, exposed as a labelled group. The record page's resting state."
          @onInput={{this.setStatic}}
        />
        <Args.String
          @name='layout'
          @defaultValue='stacked'
          @value={{this.layout}}
          @options={{this.layoutOptions}}
          @description='Label above (stacked) or beside (horizontal). Collapses to stacked below 34rem of CONTAINER width when inside a FormLayout.'
          @onInput={{this.setLayout}}
        />
        <Args.Bool
          @name='showIssue'
          @defaultValue={{true}}
          @value={{this.showIssue}}
          @description='Demo knob: feeds this field one blocking issue whose targetPath tracks the @path knob — change @path and watch the routing break, then fix itself.'
          @onInput={{this.setShowIssue}}
        />
        <Args.Object
          @name='issues'
          @description='Issues for this field when used WITHOUT a Form. Overrides the form-routed set, which is what makes the component usable stand-alone.'
        />
        <Args.Bool
          @name='hideRequiredIndicator'
          @defaultValue={{false}}
          @description='Suppress the asterisk only; the accessible marking stays.'
        />
        <Args.Bool
          @name='labelHidden'
          @defaultValue={{false}}
          @description='Keep the label in the accessible tree but out of the picture.'
        />
        <Args.Bool
          @name='reserveMessageSpace'
          @defaultValue={{true}}
          @description='Hold the message row open so a row of side-by-side fields never jumps when one grows an error.'
        />
        <Args.Bool
          @name='showAdvisory'
          @defaultValue={{true}}
          @description='Render warnings and info alongside errors.'
        />
        <Args.Bool
          @name='showRuleId'
          @defaultValue={{false}}
          @description='Print each issue ruleId as a mono Token — provenance while authoring rules (Law 3).'
        />
        <Args.Bool
          @name='announceErrors'
          @description="Override the live-region policy. Default: announce in record mode only, where a message follows one discrete commit. Never announce per keystroke."
        />
        <Args.Number
          @name='span'
          @description="Grid columns to span inside a FormLayout — SLDS's _2-col."
        />
        <Args.String
          @name='controlId'
          @description='Supply your own control id instead of the generated one.'
        />
        <Args.String
          @name='emptyText'
          @defaultValue='—'
          @description='Placeholder for a static display with no value.'
        />
        <Args.Object
          @name='form'
          @description='The owning FormContext. Supplied automatically by form.Field / grid.Field.'
        />
        <Args.Yield
          @name='control'
          @description='The control. Receives { id, labelId, describedBy, descriptionId, errorId, invalid, required, disabled, readonly, path, markDirty }.'
        />
        <Args.Yield
          @name='static'
          @description='Static display body — a link, an Avatar, a Chip. Falls back to @value.'
        />
        <Args.Yield
          @name='description'
          @description='Rich description, instead of the @description string.'
        />
        <Args.Yield
          @name='after'
          @description="Beside the control: SLDS's __undo revert button, an inline edit pencil, a unit suffix."
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='--pretui-field-label-width'
          @value='9rem'
          @description='Label column width in the horizontal layout. FormLayout sets it for a whole grid.'
        />
        <Css.Basic
          @name='--pretui-field-row-gap'
          @value='4px'
          @description='Gap between label, control, description and messages.'
        />
        <Css.Basic
          @name='--pretui-field-disabled-opacity'
          @value='0.5'
          @description='Dimming applied to a disabled field (readonly is never dimmed).'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .demo-forms-fieldstage {
        max-width: 30rem;
        width: 100%;
      }
    </style>
  </template>
}

export const DEMOS_FORM_FIELD: Record<string, unknown> = {
  FormField: FormFieldUsage,
};
