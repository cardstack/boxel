// Pretui — FormLayout usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Input } from './input';
import { Textarea } from './textarea';
import { Form } from './form';
import type { FormIssue } from '../internal/forms-core';
import { LAYOUTS } from '../demo-forms-core';

// ── FormLayout ───────────────────────────────────────────────────────────
const OPPORTUNITY_ISSUES: FormIssue[] = [
  {
    ruleId: 'opp-close-date-quarter',
    targetPath: '"Close Date"',
    severity: 'warning',
    message:
      'Close date falls after the spring booking window closes on 2026-04-30.',
  },
];

// SLDS's .slds-form (_stacked / _horizontal) plus slds-form__row /
// slds-form__item, as one grid. Dropped: the __row / __item wrappers
// themselves — a grid does not need a row element, and role='list' /
// role='listitem' on a form's fields (which SLDS's record-detail applies) is
// a semantic that helps nobody read a form.
class FormLayoutUsage extends Component {
  directionOptions = LAYOUTS;

  @tracked direction = 'horizontal';
  @tracked columns = 2;
  @tracked labelWidth = '9rem';

  @tracked contactName = 'Priya Raghunathan';
  @tracked title = 'Head of Sourcing';
  @tracked email = 'priya@nilgirileaf.coop';
  @tracked phone = '+91 423 555 0148';
  @tracked notes = 'Prefers the Nilgiri second flush shipped ahead of the monsoon.';

  setDirection = (v: string) => (this.direction = v);
  setColumns = (v: number | null) => (this.columns = v ?? 1);
  setLabelWidth = (v: string) => (this.labelWidth = v);
  setContactName = (v: string) => (this.contactName = v);
  setTitle = (v: string) => (this.title = v);
  setEmail = (v: string) => (this.email = v);
  setPhone = (v: string) => (this.phone = v);
  setNotes = (v: string) => (this.notes = v);

  issues = OPPORTUNITY_ISSUES;

  get directionVal() {
    return this.direction as 'stacked' | 'horizontal';
  }
  get usage() {
    let bits = [`@direction='${this.direction}'`, `@columns={{${this.columns}}}`];
    return `<FormLayout ${bits.join(' ')} as |grid|>\n  <grid.Field @label='Name' @path='Name'>…</grid.Field>\n  <grid.Field @label='Notes' @path='Notes' @span={{2}}>…</grid.Field>\n</FormLayout>`;
  }

  <template>
    <FreestyleUsage
      @name='FormLayout'
      @description="Stacked or horizontal, one to three columns, and it measures the PANE rather than the window — SLDS breaks its columns on @media (min-width: 48em), so a two-column form in a 320px side panel of a 1600px window stays two columns and shreds. This one uses unnamed container queries (the named form would silently delete every rule after it), collapsing three columns to two at 52rem and everything to one at 34rem, where horizontal labels also drop back above their controls. It yields a Field already curried with the direction and the form context. Drag the artboard narrow to watch it fold. Honest limit: a field can only span whole columns (@span), there is no row-and-cell addressing."
      @source={{this.usage}}
      @viewportMode='fill'
    >
      <:example>
        <Form @mode='live' @issues={{this.issues}} @label='Contact' as |form|>
          <form.Layout
            @direction={{this.directionVal}}
            @columns={{this.columns}}
            as |grid|
          >
            <grid.Field @label='Contact Name' @path='Name' @required={{true}}>
              <:control as |c|>
                <Input
                  @controlId={{c.id}}
                  @value={{this.contactName}}
                  @onInput={{this.setContactName}}
                  aria-describedby={{c.describedBy}}
                />
              </:control>
            </grid.Field>
            <grid.Field @label='Title' @path='Title'>
              <:control as |c|>
                <Input
                  @controlId={{c.id}}
                  @value={{this.title}}
                  @onInput={{this.setTitle}}
                  aria-describedby={{c.describedBy}}
                />
              </:control>
            </grid.Field>
            <grid.Field @label='Email' @path='Email'>
              <:control as |c|>
                <Input
                  @controlId={{c.id}}
                  @type='email'
                  @value={{this.email}}
                  @onInput={{this.setEmail}}
                  aria-describedby={{c.describedBy}}
                />
              </:control>
            </grid.Field>
            <grid.Field @label='Phone' @path='Phone'>
              <:control as |c|>
                <Input
                  @controlId={{c.id}}
                  @type='tel'
                  @value={{this.phone}}
                  @onInput={{this.setPhone}}
                  aria-describedby={{c.describedBy}}
                />
              </:control>
            </grid.Field>
            <grid.Field
              @label='Close Date'
              @path='"Close Date"'
              @static={{true}}
              @value='2026-05-07'
              @description='Rolled up from the spring booking window.'
            />
            <grid.Field @label='Account' @path='Account' @readonly={{true}}>
              <:control as |c|>
                <Input
                  @controlId={{c.id}}
                  @value='Nilgiri Leaf Cooperative'
                  aria-describedby={{c.describedBy}}
                  readonly={{true}}
                />
              </:control>
            </grid.Field>
            <grid.Field @label='Sourcing Notes' @path='Description' @span={{2}}>
              <:control as |c|>
                <Textarea
                  @controlId={{c.id}}
                  @value={{this.notes}}
                  @onInput={{this.setNotes}}
                  aria-describedby={{c.describedBy}}
                />
              </:control>
            </grid.Field>
          </form.Layout>
        </Form>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='direction'
          @defaultValue='stacked'
          @value={{this.direction}}
          @options={{this.directionOptions}}
          @description='Curried into every yielded Field: labels above (stacked) or beside (horizontal).'
          @onInput={{this.setDirection}}
        />
        <Args.Number
          @name='columns'
          @defaultValue={{1}}
          @value={{this.columns}}
          @min={{1}}
          @max={{3}}
          @description='1–3 grid columns, collapsing 3→2 at 52rem and →1 at 34rem of CONTAINER width.'
          @onInput={{this.setColumns}}
        />
        <Args.String
          @name='labelWidth'
          @defaultValue='9rem'
          @value={{this.labelWidth}}
          @description='Label column width in the horizontal direction — documented as the --pretui-formlayout-label-width knob below.'
          @onInput={{this.setLabelWidth}}
        />
        <Args.String
          @name='gap'
          @description='Gap between fields; also settable as --pretui-formlayout-gap.'
        />
        <Args.Object
          @name='form'
          @description='The owning FormContext, passed straight through to the yielded Field. Supplied automatically by form.Layout.'
        />
        <Args.Yield
          @description='Receives { Field, direction, columns }. Field is FormField pre-curried with the form context and the direction.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='--pretui-formlayout-gap'
          @value='var(--space-5, 14px)'
          @description='Gap between fields in both axes.'
        />
        <Css.Basic
          @name='--pretui-formlayout-label-width'
          @value='9rem'
          @description='Label column width handed down to every horizontal field in the grid.'
        />
      </:cssVars>
    </FreestyleUsage>
  </template>
}

export const DEMOS_FORM_LAYOUT: Record<string, unknown> = {
  FormLayout: FormLayoutUsage,
};
