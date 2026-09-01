import {
  FieldDef,
  field,
  contains,
  StringField,
  Component,
} from '@cardstack/base/card-api';
import PercentageField from '@cardstack/base/percentage';
import TextAreaField from '@cardstack/base/text-area';
import BadgeCheckIcon from '@cardstack/boxel-icons/badge-check';

// ConditionGrade — a graded assessment of a physical item's condition, plus what
// that grade implies for its value.
//
// DOMAIN-NEUTRAL BY CONSTRUCTION: this field names no grading scale. Sneakers
// grade DS / VNDS / 9-10; watches grade Mint / Excellent / Good; records grade
// VG+ / NM. The consumer authors the vocabulary, because only the consumer knows
// it. See the readMe in Spec/condition-grade.json for the consumption pattern —
// the consuming card overrides `code`'s enum options via `enumConfig`, exactly as
// `pets.gts` (PetOwner.preferredSpecies) does.
//
// `valueRetention` is stored rather than derived from a scale lookup on purpose:
// prerendered fitted views do not resolve linksTo, so a grade whose retention
// lived on a linked GradingScale card would render blank in every fitted tile —
// which is precisely where a collection grid shows it.

export class ConditionGrade extends FieldDef {
  static displayName = 'Condition Grade';
  static icon = BadgeCheckIcon;

  // The consumer's own vocabulary: 'DS', 'VNDS', 'Mint', 'VG+'.
  @field code = contains(StringField);

  // What this grade retains of the item's market value, 0–100.
  @field valueRetention = contains(PercentageField);

  // Free text for the specific flaw: "minor toebox crease".
  @field notes = contains(TextAreaField);

  @field summary = contains(StringField, {
    computeVia: function (this: ConditionGrade) {
      if (!this.code) {
        return '';
      }
      if (this.valueRetention == null) {
        return this.code;
      }
      return `${this.code} · ${this.valueRetention}%`;
    },
  });

  static atom = class Atom extends Component<typeof ConditionGrade> {
    <template>
      {{#if @model.code}}
        <span class='grade' title={{@model.notes}}>{{@model.code}}</span>
      {{else}}
        <span class='grade grade--unset'>—</span>
      {{/if}}
      <style scoped>
        /* Sole Vault family palette, defined locally — this field renders
           inline inside other cards, so it carries its own literal tokens
           rather than reaching for boxel-token fallbacks. */
        .grade {
          --foreground: oklch(0.147 0.004 49.25);
          --paper: var(--foreground);
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
          --gold-bright: var(--accent);
          --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;

          font-family: var(--font-mono);
          font-weight: 600;
          font-size: 0.8125rem;
          color: var(--gold-ink, var(--gold));
          letter-spacing: 0.02em;
          white-space: nowrap;
        }
        .grade--unset {
          font-weight: 400;
          color: var(--smoke);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof ConditionGrade> {
    <template>
      <div class='condition'>
        <div class='row'>
          <@fields.code @format='atom' />
          {{#if @model.valueRetention}}
            <span class='retention'><@fields.valueRetention
                @format='atom'
              /></span>
          {{/if}}
        </div>
        {{#if @model.notes}}
          <p class='notes'>{{@model.notes}}</p>
        {{/if}}
      </div>
      <style scoped>
        .condition {
          --foreground: oklch(0.147 0.004 49.25);
          --paper: var(--foreground);
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);

          display: grid;
          gap: 0.2rem;
          color: var(--paper);
        }
        .row {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
        }
        .retention {
          font-size: 0.75rem;
          color: var(--smoke);
        }
        .notes {
          margin: 0;
          font-size: 0.75rem;
          color: var(--smoke);
        }
      </style>
    </template>
  };
}

export default ConditionGrade;
