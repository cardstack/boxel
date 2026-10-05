// Pretui — CompoundField: several values edited as one field, in rows.
import Component from '@glimmer/component';
import { hash } from '@ember/helper';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FieldError } from './field-error';
import { FormSection } from './form-section';
import { issuesForPath } from '../internal/forms-core';
import type { FormIssue, FormContext } from '../internal/forms-core';
import { tracksStyle } from '../internal/forms-record';
import type { ContextualComponent } from '../internal/forms-record';

// ── CompoundField ────────────────────────────────────────────────────────
//
// Ported from SLDS `form-element/compound` + `form-element/address`
// (`slds-form-element_compound`, `__row`, `__legend`,
// `slds-form-element_address`).
//
// BETTER THAN THE INSPIRATION:
//   • SLDS's legend is `float: left` — a float purely to make room for the
//     help icon, which then needs `clear: left` on the control below to
//     undo. Ours is flow layout with a flex head; nothing floats, nothing
//     clears.
//   • SLDS's rows are `display: flex` with `margin-left/-right: -4px` and a
//     matching +4px padding on every child: the classic negative-margin
//     gutter hack. Ours is `gap`.
//   • The required marker in SLDS's Legend is
//     `<abbr class="slds-required" aria-hidden="true">*</abbr>` and nothing
//     else — a fieldset whose requiredness is invisible to assistive tech.
//     Ours adds the sr-only "(required)".
//   • SLDS's address variant does exactly one thing (`align-items:
//     baseline`) and has NO responsive behaviour: a five-part address row
//     stays five-across at any width. Ours folds sub-fields to one per line
//     on a container query.
//   • `fieldset { min-inline-size: 0 }` — the UA default is
//     `min-inline-size: min-content`, which makes a fieldset refuse to
//     shrink and blows out any grid it sits in. SLDS never resets it.
//   • Nested fields flatten through two inherited custom properties
//     (`--pretui-record-rule`, `--pretui-record-fieldpad`) rather than a
//     descendant selector reaching into another component's markup.
//
// DROPPED FROM UPSTREAM (and why): the deprecated `slds-form_compound` fork
// (`isDeprecated`), and the `slds-form-element_N-col` column classes — the
// Row's `@columns` track list and the record grid's `@span` cover the same
// ground without a class per count.
//
// BORROWED FROM THE GOV.UK DESIGN SYSTEM (2026-08-13 rebuild). SLDS is the
// layout ancestor; GOV.UK is the better ancestor for how a grouped field
// BEHAVES, because its patterns are user-tested on people filling in forms
// that matter:
//   • Errors render between the legend and the fields, never beneath them. A
//     screen reader then hears the problem as part of the group's
//     introduction, and a sighted user reads it before filling rather than
//     discovering it underneath afterwards.
//   • `@hint` is visible text, not a tooltip. Guidance needed to answer must
//     be readable without hover, which does not exist on touch. `@help` stays
//     for nice-to-know detail only.
//   • The legend is typed as a LABEL, one step stronger than its sub-field
//     labels, because it names a control group. It was an uppercase mono
//     eyebrow, which is section-divider typography.
//
// FIXED IN THE SAME PASS (defects, not preferences):
//   • The Row paired `grid-auto-flow: column` with an explicit track list.
//     Children past the last declared track created IMPLICIT columns instead
//     of wrapping, so a row never wrapped at any width. Now `auto-fit` +
//     `minmax`, which reflows through every intermediate count.
//   • The address variant set `align-items: baseline` on the body, aligning
//     the Rows against each other rather than the sub-fields — one level too
//     high, so the variant did nothing. It now travels as an inherited custom
//     property to the Row.
//   • The invalid state added `padding-inline-start`, so every field jumped
//     sideways when validation ran. The bar's gutter is now always reserved
//     and only its colour changes.
//   • `<abbr title='required'>` — a title tooltip does not open on touch and
//     is inconsistently announced. The asterisk is the visual channel; the
//     sr-only text is the real one.
export interface CompoundFieldSignature {
  Args: {
    /** The group's label, rendered as a real <legend>. Required. */
    label: string;
    /** The compound's OWN BXL label path — e.g. `Billing Address`. An issue
     *  may target the compound itself rather than a sub-field; those render
     *  here. Matched as a whole string, never split. */
    path?: string;
    /** Issues for the whole form. Only those whose `targetPath` EQUALS
     *  @path render here; sub-field issues render on their own fields. */
    issues?: FormIssue[];
    /** The owning form's context. Supplied automatically by `form.Compound`,
     *  so a collapsed compound opens when a refused submit focuses into it. */
    form?: FormContext;
    /** Visible description under the title. Guidance a user needs in order to
     *  answer must be visible: a hover tooltip does not exist on touch and is
     *  missed on desktop. Wired to the fieldset with `aria-describedby` by
     *  `FormSection`. */
    hint?: string;
    /** Give the section a disclosure. Available because the presentation is
     *  `FormSection`; the hand-rolled version had no such thing. */
    collapsible?: boolean;
    /** Uncontrolled seed for the disclosure. @default true */
    defaultOpen?: boolean;
    /** Controlled disclosure state. Omit and use @defaultOpen. */
    open?: boolean;
    /** Fires with the requested state whenever the disclosure moves. */
    onOpenChange?: (open: boolean) => void;
    /** Native fieldset disabling — every control inside goes dead while the
     *  disclosure keeps working. */
    disabled?: boolean;
    /** 'address' aligns sub-fields on their baseline, matching SLDS's
     *  `slds-form-element_address`. @default 'default' */
    variant?: 'default' | 'address';
    /** 'full' makes the group span every column of a record grid.
     *  @default 'auto' */
    span?: 'auto' | 'full';
  };
  Blocks: {
    /** Yields `{ Row }`. Put the record's own `<R.Field>`s inside a Row —
     *  they keep participating in the batch, because a compound is a layout
     *  and legend contract, not a second state machine. */
    default: [{ Row: ContextualComponent }];
  };
  Element: HTMLFieldSetElement;
}

/** One row of sub-fields inside a CompoundField (SLDS
 *  `.slds-form-element__row`). */
export interface CompoundRowSignature {
  Args: {
    /** A `grid-template-columns` track list — `'2fr 1fr 1fr'` for a
     *  street/city/state row. Validated before it reaches the style
     *  attribute. It travels as a custom property rather than an inline
     *  `grid-template-columns` precisely so the narrow container query can
     *  still override it without `!important`.
     *
     *  **Omit it for the better default.** With no track list the row is
     *  `repeat(auto-fit, minmax(9rem, 1fr))`, which reflows through every
     *  intermediate count as the container narrows. A fixed track list gives
     *  up that ladder and only collapses at the final breakpoint, so reach for
     *  it when the proportions genuinely matter (a street that must be twice
     *  a city) and not otherwise. The floor is the `--pretui-compound-min`
     *  custom property if 9rem is wrong for your controls. */
    columns?: string;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export const CompoundRow: TemplateOnlyComponent<CompoundRowSignature> =
  <template>
    <div
      class='pretui-compound-row'
      style={{tracksStyle @columns}}
      data-test-pretui-compound-row
      ...attributes
    >{{yield}}</div>
    <style scoped>
      @layer PretComponent {
        .pretui-compound-row {
          display: grid;
          /* Graceful reflow, not an all-or-nothing fold. `auto-fit` + `minmax`
             lets a five-part address go 5 → 3 → 2 → 1 as the container narrows,
             each sub-field keeping a legible minimum. The previous rule paired
             `grid-auto-flow: column` with an explicit track list, which is a
             contradiction: children past the last declared track silently
             created IMPLICIT columns instead of wrapping, so a row never wrapped
             at any width and six sub-fields rendered six-across and squeezed. */
          grid-template-columns: var(
            --pretui-compound-tracks,
            repeat(auto-fit, minmax(var(--pretui-compound-min, 9rem), 1fr))
          );
          /* Sub-fields align on their own baseline only when the compound asks
             for it. This travels as an inherited custom property because
             .pretui-compound-row belongs to THIS component while the variant is
             set on its parent — a descendant selector would have to reach across
             a scoped-CSS boundary, which does not match. */
          align-items: var(--pretui-compound-align, stretch);
          gap: var(--space-2, 5px) var(--space-4, 11px);
          min-width: 0;
          /* NO flattening. The previous version set --pretui-record-rule to
             transparent and --pretui-record-fieldpad to 0, hiding each
             sub-field's rule and padding so that N peer fields would read as one
             value. That was the cosmetic half of a pretence this component no
             longer makes: these are fields in a section, and they look like it. */
        }
        /* The last step of the ladder: below this, even two columns leave a
           control too narrow to read, so drop to one per line. */
        @container (max-width: 22rem) {
          .pretui-compound-row {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      }
    </style>
  </template>;

/** A group of related record fields.
 *
 *  THIS IS A SECTION, NOT A FIELD — and that is the whole design. The earlier
 *  version rendered a `<fieldset>` with a legend around N `RecordField`s, each
 *  of which is a complete inline-edit machine with its own label, its own
 *  "press Enter to edit", its own discard control, its own dirty marker and its
 *  own entry in the save batch. So one conceptual value like "Mailing Address"
 *  presented a legend plus five labels and five independent editors, and the
 *  component's only real contribution was CSS that hid the per-field rules to
 *  make five peers *look* like one value. That is a section wearing a field's
 *  clothes, and no amount of spacing work fixes it.
 *
 *  Two honest resolutions existed: collapse the read view to one formatted
 *  value and expand to parts on edit (a true compound FIELD), or stop
 *  pretending and be a section. This is the second.
 *
 *  Consequently the presentation delegates to `FormSection` rather than
 *  reimplementing it. `FormSection` already owns the legend, the description,
 *  the issue count, native fieldset disabling and a controlled/uncontrolled
 *  disclosure — all of which this component lacked, and a second, weaker copy
 *  of it is exactly the duplication the house rules forbid. Sections gain
 *  collapsibility here for free.
 *
 *  The sub-fields stay the record's own `<R.Field>`s, so they keep
 *  participating in the same batch, the same undo and the same footer. They now
 *  also keep their rules and padding: they ARE fields, and flattening them was
 *  the cosmetic half of the original pretence.
 */
export class CompoundField extends Component<CompoundFieldSignature> {
  get variant(): string {
    return this.args.variant === 'address' ? 'address' : 'default';
  }
  get issues(): FormIssue[] {
    return issuesForPath(
      this.args.issues ?? this.args.form?.issues ?? [],
      this.args.path,
    );
  }
  /** the compound claims its own path, or FormSection would drop its issues */
  get ownPaths(): string[] | undefined {
    return this.args.path ? [this.args.path] : undefined;
  }

  <template>
    <div
      class='pretui-compound'
      data-variant={{this.variant}}
      data-span={{if @span @span 'auto'}}
      data-test-pretui-compound-field={{@label}}
      ...attributes
    >
      <FormSection
        @title={{@label}}
        @description={{@hint}}
        @issues={{this.issues}}
        @paths={{this.ownPaths}}
        @form={{@form}}
        @collapsible={{@collapsible}}
        @defaultOpen={{@defaultOpen}}
        @open={{@open}}
        @onOpenChange={{@onOpenChange}}
        @disabled={{@disabled}}
      >
        {{! FormSection yields its own Field/Layout curried to a Form; a record
            section deliberately does NOT forward them. Its children are the
            record's <R.Field>s, which carry the batch. Only Row is ours. }}
        {{#each this.issues as |issue|}}
          <FieldError class='pretui-compound-issue' @issue={{issue}} />
        {{/each}}
        {{yield (hash Row=CompoundRow)}}
      </FormSection>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-compound {
          /* the container the Row's query measures against — that query lives on
             a DESCENDANT (.pretui-compound-row), never on this element */
          container-type: inline-size;
          min-inline-size: 0;
          min-width: 0;
        }
        .pretui-compound[data-span='full'] {
          grid-column: 1 / -1;
        }
        /* Sub-fields align on their own baseline only when the section asks for
           it. Travels as an inherited custom property because the Row belongs to
           this component while the variant is set on its ancestor — a descendant
           selector would have to cross a scoped-CSS boundary, which does not
           match. */
        .pretui-compound[data-variant='address'] {
          --pretui-compound-align: baseline;
        }
      }
    </style>
  </template>
}
