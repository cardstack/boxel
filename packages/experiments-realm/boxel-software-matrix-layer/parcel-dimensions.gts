import {
  Component,
  FieldDef,
  contains,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import BoxIcon from '@cardstack/boxel-icons/box';

// Parcel Dimensions (PD) — what the packing station measures, and what the
// carrier actually bills on.
//
// Carriers charge for the greater of actual weight and *volumetric* weight
// (a big light box occupies the same van space as a small heavy one). The
// divisor that converts volume to weight differs per carrier, so the block does
// not pick one: the consumer supplies `dimDivisor` (the Carrier card stores it
// and stamps it onto the shipment). With no divisor the block reports actual
// weight rather than inventing a number.
//
// Non-goals: metric only. An imperial variant is a separate concern and would
// need unit-aware serialization, not a display toggle.
export class ParcelDimensionsField extends FieldDef {
  static displayName = 'Parcel Dimensions';
  static icon = BoxIcon;

  @field length = contains(NumberField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
  @field weight = contains(NumberField);
  @field dimDivisor = contains(NumberField);

  @field volume = contains(NumberField, {
    computeVia: function (this: ParcelDimensionsField) {
      let { length: l, width: w, height: h } = this;
      if (!l || !w || !h) {
        return undefined;
      }
      return Math.round(l * w * h);
    },
  });

  @field volumetricWeight = contains(NumberField, {
    computeVia: function (this: ParcelDimensionsField) {
      let volume = this.volume;
      let divisor = this.dimDivisor;
      if (!volume || !divisor) {
        return undefined;
      }
      return Math.round((volume / divisor) * 100) / 100;
    },
  });

  @field billableWeight = contains(NumberField, {
    computeVia: function (this: ParcelDimensionsField) {
      let actual = this.weight ?? 0;
      let volumetric = this.volumetricWeight ?? 0;
      let billable = Math.max(actual, volumetric);
      return billable > 0 ? billable : undefined;
    },
  });

  get sizeLabel() {
    let { length: l, width: w, height: h } = this;
    if (!l || !w || !h) {
      return undefined;
    }
    return `${l} × ${w} × ${h} cm`;
  }

  // True when the carrier will bill more than the scale says — the number a
  // packer can act on by choosing a smaller box.
  get isVolumetric() {
    return (
      this.volumetricWeight != null &&
      this.weight != null &&
      this.volumetricWeight > this.weight
    );
  }

  static atom = class Atom extends Component<typeof ParcelDimensionsField> {
    <template>
      {{#if @model.billableWeight}}
        <span class='pd-atom'>{{@model.billableWeight}} kg</span>
      {{else}}
        <span class='pd-atom pd-empty'>Not measured</span>
      {{/if}}

      <style scoped>
        .pd-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.9em;
          font-variant-numeric: tabular-nums;
          color: var(--foreground, var(--boxel-dark));
        }
        .pd-empty {
          color: var(--muted-foreground, var(--boxel-400));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<
    typeof ParcelDimensionsField
  > {
    <template>
      <div class='pd'>
        <span class='pd-size'>{{if
            @model.sizeLabel
            @model.sizeLabel
            'Unmeasured parcel'
          }}</span>
        <span class='pd-sep' aria-hidden='true'></span>
        <span class='pd-weight'>{{if @model.weight @model.weight '—'}} kg</span>
        {{#if @model.isVolumetric}}
          <span class='pd-billable'>bills at
            {{@model.volumetricWeight}}
            kg</span>
        {{/if}}
      </div>

      <style scoped>
        .pd {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xxs);
          font-size: 0.85rem;
          color: var(--foreground, var(--boxel-dark));
        }
        .pd-size {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .pd-sep {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--muted-foreground, var(--boxel-400));
        }
        .pd-weight {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        /* The dimensional-weight warning is the only thing here a packer can
           act on, so it is the only thing that gets a tint. */
        .pd-billable {
          font-size: 0.75rem;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 999px;
          color: var(--muted-foreground, var(--boxel-500));
          background: color-mix(
            in oklch,
            var(--muted-foreground, var(--boxel-500)) 12%,
            transparent
          );
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof ParcelDimensionsField> {
    <template>
      <fieldset class='pd-edit'>
        <legend class='pd-legend'>Measured at the packing station</legend>
        <div class='pd-grid'>
          <FieldContainer @label='Length (cm)' @vertical={{true}}>
            <@fields.length />
          </FieldContainer>
          <FieldContainer @label='Width (cm)' @vertical={{true}}>
            <@fields.width />
          </FieldContainer>
          <FieldContainer @label='Height (cm)' @vertical={{true}}>
            <@fields.height />
          </FieldContainer>
          <FieldContainer @label='Weight (kg)' @vertical={{true}}>
            <@fields.weight />
          </FieldContainer>
        </div>

        {{#if @model.billableWeight}}
          <p class='pd-readout'>
            Billable weight
            <strong>{{@model.billableWeight}} kg</strong>
            {{#if @model.isVolumetric}}
              — volumetric, from
              {{@model.volume}}
              cm³. A smaller box would lower this.
            {{else}}
              — actual weight.
            {{/if}}
          </p>
        {{/if}}
      </fieldset>

      <style scoped>
        .pd-edit {
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius, 8px);
          padding: var(--boxel-sp-sm);
          margin: 0;
          background: var(--card, var(--boxel-light));
        }
        .pd-legend {
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-500));
          padding: 0 var(--boxel-sp-xxs);
        }
        .pd-grid {
          display: grid;
          gap: var(--boxel-sp-xs);
          grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
        }
        .pd-readout {
          margin: var(--boxel-sp-sm) 0 0;
          font-size: 0.8rem;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .pd-readout strong {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          color: var(--foreground, var(--boxel-dark));
        }
      </style>
    </template>
  };
}

export default ParcelDimensionsField;
