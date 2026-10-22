// Pretui — CompoundField usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { RecordDetail } from './record-detail';
import { Input } from './input';
import { Select } from './select';
import {
  PEOPLE,
  PLACES,
  pick,
} from '../examples';
import type { FormIssue } from '../internal/forms-core';
import { SEED, asOptions, str } from '../demo-forms-record';

// ── CompoundField ────────────────────────────────────────────────────────
const CONTACT_ISSUES: FormIssue[] = [
  {
    ruleId: 'contact-name-required',
    targetPath: 'Name',
    severity: 'error',
    message: 'A contact needs at least a last name.',
  },
  {
    ruleId: 'contact-postal-format',
    targetPath: 'Mailing Postal Code',
    severity: 'error',
    message: 'Postal code does not match the format for the selected country.',
  },
  {
    ruleId: 'contact-address-advisory',
    targetPath: 'Mailing Address',
    severity: 'warning',
    message:
      'This address has not been verified against the carrier database ' +
      'since the last shipment.',
  },
];

interface ContactRecord {
  salutation: string;
  first: string;
  last: string;
  street: string;
  city: string;
  state: string;
  postal: string;
  country: string;
}

const CONTACT_NAME = pick(SEED, 3, PEOPLE).split(' ');

const CONTACT: ContactRecord = {
  salutation: 'Ms.',
  first: CONTACT_NAME[0],
  last: CONTACT_NAME[1] ?? 'Chua',
  street: '14 Cloud Terrace, Warehouse 3',
  city: pick(SEED, 4, PLACES),
  state: 'Fujian',
  postal: '354300',
  country: 'China',
};

const SALUTATION_OPTIONS = asOptions(['Ms.', 'Mr.', 'Mx.', 'Dr.', 'Prof.']);

const COUNTRY_OPTIONS = asOptions([
  'China',
  'Japan',
  'India',
  'Kenya',
  'Sri Lanka',
  'Taiwan',
]);

class CompoundFieldUsage extends Component {
  @tracked contact: ContactRecord = { ...CONTACT };
  @tracked variant = 'address';
  @tracked collapsible = false;
  @tracked showIssues = false;
  @tracked log = '';

  setVariant = (v: string) => (this.variant = v);
  setCollapsible = (v: boolean) => (this.collapsible = v);
  setShowIssues = (v: boolean) => (this.showIssues = v);

  get variantMode(): 'default' | 'address' {
    return this.variant === 'address' ? 'address' : 'default';
  }
  get variantOptions() {
    return ['default', 'address'];
  }
  get issues(): FormIssue[] {
    return this.showIssues ? CONTACT_ISSUES : [];
  }
  get addressHint(): string {
    return 'Where shipping documents are couriered, not the estate address.';
  }
  get salutationOptions() {
    return SALUTATION_OPTIONS;
  }
  get countryOptions() {
    return COUNTRY_OPTIONS;
  }

  applySave = (changes: Record<string, unknown>) => {
    let map: Record<string, keyof ContactRecord> = {
      Salutation: 'salutation',
      'First Name': 'first',
      'Last Name': 'last',
      'Mailing Street': 'street',
      'Mailing City': 'city',
      'Mailing State/Province': 'state',
      'Mailing Postal Code': 'postal',
      'Mailing Country': 'country',
    };
    let next = { ...this.contact } as Record<string, unknown>;
    let wrote: string[] = [];
    for (let path of Object.keys(changes)) {
      let key = map[path];
      if (key) {
        next[key] = changes[path];
        wrote.push(path);
      }
    }
    this.contact = next as unknown as ContactRecord;
    this.log = wrote.length ? `Wrote ${wrote.join(', ')}` : 'Nothing to write.';
  };

  get usage() {
    return [
      `<R.Compound @path='Mailing Address' @label='Mailing Address'`,
      `  @variant='${this.variantMode}' @collapsible={{${this.collapsible}}}`,
      `  @span='full' as |C|>`,
      `  <C.Row>`,
      `    <R.Field @path='Mailing Street' @label='Street' … />`,
      `  </C.Row>`,
      `  <C.Row @columns='2fr 1fr 1fr'>`,
      `    <R.Field @path='Mailing City' @label='City' … />`,
      `    <R.Field @path='Mailing State/Province' @label='State' … />`,
      `    <R.Field @path='Mailing Postal Code' @label='Postal Code' … />`,
      `  </C.Row>`,
      `</R.Compound>`,
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='CompoundField'
      @description="A SECTION of related record fields, not a compound field — and the distinction is the whole design. Each <R.Field> inside is a complete inline-edit machine with its own label, editor, discard and entry in the save batch, so a group of five is five peer fields, not one value. This component groups and titles them honestly rather than hiding their rules to make them look like one value. Its presentation delegates to FormSection, which already owns the legend, description, issue count, native fieldset disabling and a controlled/uncontrolled disclosure — so sections are collapsible here for free, and there is no second, weaker copy of that component. Reach for it wherever one conceptual value is stored as several columns, which in Salesforce data is constant: Name (salutation + first + last) and Address (street + city + state + postal + country) are the two canonical cases and both are on the bench below. It is a layout and legend contract, not a second state machine: put the record's own <R.Field>s inside a <C.Row> and they keep participating in the same batch, the same undo and the same footer. Issue routing takes care here — an issue may target the compound itself ('Mailing Address') or a sub-field ('Mailing Postal Code'), and both are matched as whole strings, so the compound's own message renders between the legend and the fields (GOV.UK's placement — you read the problem before you fill, not after) while the sub-field's renders under its own field. Sub-field layout is responsive on an unnamed container query measured on the compound, where the upstream address variant has no responsive behaviour at all."
      @source={{this.usage}}
    >
      <:example>
        <div class='cf-stage'>
          <RecordDetail
            @columns={{1}}
            @issues={{this.issues}}
            @onSave={{this.applySave}}
            as |R|
          >
            <R.Compound
              @path='Name'
              @label='Name'
                            @span='full'
              as |C|
            >
              <C.Row @columns='1fr 2fr 2fr'>
                <R.Field
                  @path='Salutation'
                  @label='Salutation'
                  @value={{this.contact.salutation}}
                >
                  <:editor as |E|>
                    <Select
                      @options={{this.salutationOptions}}
                      @value={{str E.value}}
                      @controlId={{E.controlId}}
                      @onValueChange={{E.set}}
                    />
                  </:editor>
                </R.Field>
                <R.Field
                  @path='First Name'
                  @label='First Name'
                  @value={{this.contact.first}}
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
                  @path='Last Name'
                  @label='Last Name'
                  @value={{this.contact.last}}
                  @required={{true}}
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
              </C.Row>
            </R.Compound>

            <R.Compound
              @path='Mailing Address'
              @label='Mailing Address'
              @variant={{this.variantMode}}
              @hint={{this.addressHint}}
              @span='full'
              as |C|
            >
              <C.Row>
                <R.Field
                  @path='Mailing Street'
                  @label='Street'
                  @value={{this.contact.street}}
                  @longform={{true}}
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
              </C.Row>
              <C.Row @columns='2fr 1fr 1fr'>
                <R.Field
                  @path='Mailing City'
                  @label='City'
                  @value={{this.contact.city}}
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
                  @path='Mailing State/Province'
                  @label='State'
                  @value={{this.contact.state}}
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
                  @path='Mailing Postal Code'
                  @label='Postal Code'
                  @value={{this.contact.postal}}
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
              </C.Row>
              <C.Row>
                <R.Field
                  @path='Mailing Country'
                  @label='Country'
                  @value={{this.contact.country}}
                >
                  <:editor as |E|>
                    <Select
                      @options={{this.countryOptions}}
                      @value={{str E.value}}
                      @controlId={{E.controlId}}
                      @onValueChange={{E.set}}
                    />
                  </:editor>
                </R.Field>
              </C.Row>
            </R.Compound>
          </RecordDetail>

          {{#if this.log}}
            <p class='cf-log'>{{this.log}}</p>
          {{/if}}
        </div>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='variant'
          @value={{this.variant}}
          @options={{this.variantOptions}}
          @defaultValue='default'
          @description="'address' aligns sub-fields on their baseline (SLDS slds-form-element_address); 'default' aligns to the start."
          @onInput={{this.setVariant}}
        />
        <Args.Bool
          @name='collapsible'
          @value={{this.collapsible}}
          @defaultValue={{false}}
          @description='Gives the section a disclosure. Free, because the presentation is FormSection — the hand-rolled compound had no such thing. @required and @help are gone: requiredness belongs to a FIELD, and guidance a user needs to answer must be visible, so it moved to @hint.'
          @onInput={{this.setCollapsible}}
        />
        <Args.Bool
          @name='issues'
          @value={{this.showIssues}}
          @defaultValue={{false}}
          @description='Injects three issues that exercise both routes at once: one on the compound path “Name”, one on the compound path “Mailing Address”, and one on the SUB-FIELD path “Mailing Postal Code”. The compound’s render under the fieldset; the sub-field’s renders under its own field. Whole-string matching throughout.'
          @onInput={{this.setShowIssues}}
        />
        <Args.String
          @name='label'
          @required={{true}}
          @description='The group’s label, rendered as a real <legend> — first child of the fieldset, as the element requires.'
          @hideControls={{true}}
        />
        <Args.String
          @name='path'
          @description='The compound’s OWN BXL label path. Issues whose targetPath equals it render here rather than on any sub-field.'
          @hideControls={{true}}
        />
        <Args.String
          @name='span'
          @defaultValue='auto'
          @description="'full' spans every column of the enclosing record grid — what both compounds use here."
          @hideControls={{true}}
        />
        <Args.Yield
          @description='Yields { Row }. Row takes @columns — a validated grid-template-columns track list such as “2fr 1fr 1fr”. It travels as a custom property rather than an inline style precisely so the narrow container query can still override it without !important.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .cf-stage {
        display: grid;
        gap: var(--space-3, 8px);
        min-width: 0;
      }
      .cf-log {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_COMPOUND_FIELD: Record<string, unknown> = {
  CompoundField: CompoundFieldUsage,
};
