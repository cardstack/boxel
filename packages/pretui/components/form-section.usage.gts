// Pretui — FormSection usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Input } from './input';
import { Select } from './select';
import { Form } from './form';
import type { FormApi } from './form';
import type { FormIssue } from '../internal/forms-core';
import { OWNERS, SECTIONED_ISSUES } from '../demo-forms-core';

// ── FormSection ──────────────────────────────────────────────────────────
const ACCOUNT_TYPES = [
  { value: 'supplier', label: 'Supplier — Direct Trade' },
  { value: 'broker', label: 'Broker' },
  { value: 'cooperative', label: 'Cooperative' },
  { value: 'estate', label: 'Estate' },
];

const PAYMENT_TERMS = [
  { value: 'net-30', label: 'Net 30' },
  { value: 'net-60', label: 'Net 60' },
  { value: 'net-90', label: 'Net 90' },
];

const APPROVAL_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

// The multi-section demo's guide-rule result: one error in the FIRST
// section, one advisory in the second, one error inside the section that
// starts COLLAPSED, and one unroutable predicate path for the summary.

// Grouping, on the shape an enterprise account record actually has: three
// sections, two of them two-column, one collapsed, and a blocking issue
// living inside the collapsed one so the interaction between sections and
// ErrorSummary is on stage rather than described.
class FormSectionUsage extends Component {
  @tracked collapsible = true;
  @tracked termsOpen = false;
  @tracked billingLocked = false;
  @tracked columns = 2;
  @tracked lastEvent = 'nothing yet';

  @tracked accountName = 'Wuyi Origins';
  @tracked accountType = 'supplier';
  @tracked owner = 'mei-lin';
  @tracked website = '';
  @tracked street = '14 Cliff Tea Road';
  @tracked city = 'Wuyishan';
  @tracked province = 'Fujian';
  @tracked postal = '354300';
  @tracked country = 'China';
  @tracked terms = 'net-90';
  @tracked approval = 'pending';

  setCollapsible = (v: boolean) => (this.collapsible = v);
  setTermsOpen = (v: boolean) => (this.termsOpen = v);
  setBillingLocked = (v: boolean) => (this.billingLocked = v);
  setColumns = (v: number | null) => (this.columns = v ?? 1);
  setAccountName = (v: string) => (this.accountName = v);
  setAccountType = (v: string) => (this.accountType = v);
  setOwner = (v: string) => (this.owner = v);
  setWebsite = (v: string) => (this.website = v);
  setStreet = (v: string) => (this.street = v);
  setCity = (v: string) => (this.city = v);
  setProvince = (v: string) => (this.province = v);
  setPostal = (v: string) => (this.postal = v);
  setCountry = (v: string) => (this.country = v);
  setTerms = (v: string) => (this.terms = v);
  setApproval = (v: string) => (this.approval = v);

  issues = SECTIONED_ISSUES;
  typeOptions = ACCOUNT_TYPES;
  ownerOptions = OWNERS;
  termOptions = PAYMENT_TERMS;
  approvalOptions = APPROVAL_STATUSES;

  handleSubmit = () => {
    this.lastEvent = 'onSubmit — the gate passed';
  };
  handleInvalid = (issues: FormIssue[]) => {
    this.lastEvent = `onInvalidSubmit — refused with ${issues.length} blocking issue(s); the Terms section opened itself so focus could land`;
  };

  get usage() {
    return `<form.Section @title='Billing Address' @description='…'\n  @collapsible={{true}} @defaultOpen={{false}} as |sec|>\n  <sec.Layout @columns={{${this.columns}}} as |grid|>\n    <grid.Field @label='Billing Street' @path='"Billing Street"' @span={{2}}>\n      <:control as |c|><Input @controlId={{c.id}} … /></:control>\n    </grid.Field>\n    <grid.Field @label='Billing City' @path='"Billing City"'>…</grid.Field>\n  </sec.Layout>\n</form.Section>`;
  }

  <template>
    <FreestyleUsage
      @name='FormSection'
      @description="Grouping — a real <fieldset> with a real <legend>, because that pairing IS the group for assistive tech and a div with a heading beside it is not. The element earns its keep twice over: <fieldset disabled> natively switches off every control inside, including caller-supplied ones the component has never heard of, and the spec exempts the legend, so a locked section can still be expanded. Sections nest inside FormLayout and yield their own Layout, so a two-column arrangement inside a section still counts toward that section's issue badge. On collapsed errors the choice here is BOTH: the body is hidden rather than unmounted, so its fields stay registered and their issues still route to the ErrorSummary; the legend carries a live issue count (and so announces 'Terms and Approval, 1 error'); and a refused commit auto-expands any section holding a blocking issue, because focus cannot land on a hidden control and a user cannot fix what they cannot see. Submit below with Terms collapsed to watch all three fire at once."
      @source={{this.usage}}
      @viewportMode='fill'
    >
      <:example>
        <Form
          @mode='submit'
          @issues={{this.issues}}
          @label='Account — Wuyi Origins'
          @onSubmit={{this.handleSubmit}}
          @onInvalidSubmit={{this.handleInvalid}}
        >
          <:default as |form|>
            <form.Summary @showAdvisory={{true}} />

            <form.Section
              @title='Account Details'
              @description='Identity and ownership. Everything here is on the supplier scorecard.'
              as |sec|
            >
              <sec.Layout @columns={{this.columns}} as |grid|>
                <grid.Field
                  @label='Account Name'
                  @path='Name'
                  @required={{true}}
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
                <grid.Field @label='Account Type' @path='Type'>
                  <:control as |c|>
                    <Select
                      @controlId={{c.id}}
                      @options={{this.typeOptions}}
                      @value={{this.accountType}}
                      @disabled={{c.disabled}}
                      @onValueChange={{this.setAccountType}}
                    />
                  </:control>
                </grid.Field>
                <grid.Field @label='Account Owner' @path='"Account Owner"'>
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
                  @label='Website'
                  @path='Website'
                  @required={{true}}
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
              </sec.Layout>
            </form.Section>

            <form.Section
              @title='Billing Address'
              @description='Where the invoices go. Locked while the finance sync is running.'
              @disabled={{this.billingLocked}}
              as |sec|
            >
              <sec.Layout @columns={{this.columns}} as |grid|>
                <grid.Field
                  @label='Billing Street'
                  @path='"Billing Street"'
                  @span={{2}}
                >
                  <:control as |c|>
                    <Input
                      @controlId={{c.id}}
                      @value={{this.street}}
                      @onInput={{this.setStreet}}
                      aria-describedby={{c.describedBy}}
                    />
                  </:control>
                </grid.Field>
                <grid.Field @label='Billing City' @path='"Billing City"'>
                  <:control as |c|>
                    <Input
                      @controlId={{c.id}}
                      @value={{this.city}}
                      @onInput={{this.setCity}}
                      aria-describedby={{c.describedBy}}
                    />
                  </:control>
                </grid.Field>
                <grid.Field
                  @label='State/Province'
                  @path='"Billing State"'
                >
                  <:control as |c|>
                    <Input
                      @controlId={{c.id}}
                      @value={{this.province}}
                      @onInput={{this.setProvince}}
                      aria-describedby={{c.describedBy}}
                    />
                  </:control>
                </grid.Field>
                <grid.Field
                  @label='Postal Code'
                  @path='"Billing Postal Code"'
                >
                  <:control as |c|>
                    <Input
                      @controlId={{c.id}}
                      @value={{this.postal}}
                      @onInput={{this.setPostal}}
                      aria-describedby={{c.describedBy}}
                      aria-invalid={{if c.invalid 'true'}}
                    />
                  </:control>
                </grid.Field>
                <grid.Field @label='Country' @path='"Billing Country"'>
                  <:control as |c|>
                    <Input
                      @controlId={{c.id}}
                      @value={{this.country}}
                      @onInput={{this.setCountry}}
                      aria-describedby={{c.describedBy}}
                    />
                  </:control>
                </grid.Field>
              </sec.Layout>
            </form.Section>

            <form.Section
              @title='Terms and Approval'
              @description='Collapsed, and holding a blocking issue. Hit Save: the legend grows a count, the section opens itself, and focus lands inside.'
              @collapsible={{this.collapsible}}
              @open={{this.termsOpen}}
              @onOpenChange={{this.setTermsOpen}}
              as |sec|
            >
              <sec.Layout @columns={{1}} as |grid|>
                <grid.Field
                  @label='Payment Terms'
                  @path='"Payment Terms"'
                  @description='Anything past Net 60 needs a named approver.'
                >
                  <:control as |c|>
                    <Select
                      @controlId={{c.id}}
                      @options={{this.termOptions}}
                      @value={{this.terms}}
                      @disabled={{c.disabled}}
                      @onValueChange={{this.setTerms}}
                    />
                  </:control>
                </grid.Field>
                <grid.Field
                  @label='Approval Status'
                  @path='"Approval Status"'
                  @required={{true}}
                >
                  <:control as |c|>
                    <Select
                      @controlId={{c.id}}
                      @options={{this.approvalOptions}}
                      @value={{this.approval}}
                      @disabled={{c.disabled}}
                      @onValueChange={{this.setApproval}}
                    />
                  </:control>
                </grid.Field>
              </sec.Layout>
            </form.Section>
          </:default>
          <:footer as |form|>
            <span class='demo-forms-state'>{{this.stateLine form}}</span>
            <Button type='submit' @busy={{form.busy}}>Save record</Button>
          </:footer>
        </Form>
        <p class='demo-forms-readout'>{{this.lastEvent}}</p>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='collapsible'
          @defaultValue={{false}}
          @value={{this.collapsible}}
          @description='Give the section a disclosure button in its legend, with aria-expanded and aria-controls.'
          @onInput={{this.setCollapsible}}
        />
        <Args.Bool
          @name='open'
          @value={{this.termsOpen}}
          @description='Controlled open state (this page drives the Terms section with it). Omit and seed @defaultOpen for uncontrolled use.'
          @onInput={{this.setTermsOpen}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.billingLocked}}
          @description='Native fieldset disabling, applied here to Billing Address: every control inside goes dead without any of them being told, and the legend keeps working so the section can still be collapsed.'
          @onInput={{this.setBillingLocked}}
        />
        <Args.Number
          @name='columns'
          @defaultValue={{2}}
          @value={{this.columns}}
          @min={{1}}
          @max={{3}}
          @description='Demo knob for the nested sec.Layout inside the first two sections — grouping and grid are separate concerns and compose.'
          @onInput={{this.setColumns}}
        />
        <Args.String
          @name='title'
          @description='The legend, and therefore the group name assistive tech reads on entry.'
        />
        <Args.String
          @name='description'
          @description='Prose under the legend, wired to the fieldset with aria-describedby.'
        />
        <Args.Bool
          @name='defaultOpen'
          @defaultValue={{true}}
          @description='Uncontrolled seed for the disclosure.'
        />
        <Args.Bool
          @name='hideIssueCount'
          @defaultValue={{false}}
          @description='Hide the legend badge. Strongly discouraged: on a collapsed section the badge is the only synchronous signal that something inside is broken.'
        />
        <Args.Object
          @name='paths'
          @description='Explicit list of paths the section owns — only needed when its fields are rendered lazily and so cannot register themselves. Merged with the registered set.'
        />
        <Args.Object
          @name='issues'
          @description='Issues to consider when used WITHOUT a Form.'
        />
        <Args.Number
          @name='span'
          @description='Grid columns to span inside a FormLayout. Default: all of them, because a group is normally a full-width band.'
        />
        <Args.Action
          @name='onOpenChange'
          @description='Fires with the requested state whenever the disclosure moves — including when the form opens the section to reach an error.'
        />
        <Args.Object
          @name='form'
          @description='The owning FormContext. Supplied automatically by form.Section / grid.Section.'
        />
        <Args.Yield
          @description='Section content. Receives { Field, Layout, open, issues } — Field and Layout both pre-curried with the form context AND this section.'
        />
        <Args.Yield
          @name='actions'
          @description='Rendered at the right of the legend row — a row count, an "Add row" link.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='--pretui-section-gap'
          @value='var(--space-4, 11px)'
          @description='Rhythm between the legend, description and body, and between fields inside the body.'
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

  stateLine = (api: FormApi) =>
    `${api.dirty ? 'dirty' : 'pristine'} · ${api.submitted ? 'submit attempted' : 'not yet submitted'} · ${api.blockingIssues.length} blocking`;
}

export const DEMOS_FORM_SECTION: Record<string, unknown> = {
  FormSection: FormSectionUsage,
};
