import {
  Component,
  FieldDef,
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import { CopyButton } from '@cardstack/boxel-ui/components';
import BarcodeIcon from '@cardstack/boxel-icons/barcode';

// Tracking Number (TN) — a carrier's reference for a package, plus enough
// context to turn it into a link.
//
// The block has no opinion about which carriers exist. A tracking URL is built
// from a pattern the CONSUMER supplies (the Carrier card stores it, and copies
// it onto the shipment when the label is created), so adding a carrier never
// means editing this file. `{number}` is the only placeholder.
export class TrackingNumberField extends FieldDef {
  static displayName = 'Tracking Number';
  static icon = BarcodeIcon;

  @field number = contains(StringField);
  @field carrierCode = contains(StringField);
  @field trackingUrlPattern = contains(StringField);

  @field trackingUrl = contains(StringField, {
    computeVia: function (this: TrackingNumberField) {
      let n = this.number?.trim();
      let pattern = this.trackingUrlPattern?.trim();
      if (!n || !pattern || !pattern.includes('{number}')) {
        return undefined;
      }
      return pattern.replace('{number}', encodeURIComponent(n));
    },
  });

  // Carriers group their reference numbers in fours; unbroken 12-digit runs are
  // near-impossible to read back off a screen to someone on the phone.
  @field grouped = contains(StringField, {
    computeVia: function (this: TrackingNumberField) {
      let n = this.number?.replace(/\s+/g, '');
      if (!n) {
        return undefined;
      }
      return n.replace(/(.{4})/g, '$1 ').trim();
    },
  });

  static atom = class Atom extends Component<typeof TrackingNumberField> {
    <template>
      {{#if @model.number}}
        <span class='tn-atom' title={{@model.number}}>{{@model.number}}</span>
      {{else}}
        <span class='tn-empty'>—</span>
      {{/if}}

      <style scoped>
        .tn-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.9em;
          letter-spacing: 0.02em;
          color: var(--foreground, var(--boxel-dark));
        }
        .tn-empty {
          color: var(--muted-foreground, var(--boxel-400));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<
    typeof TrackingNumberField
  > {
    <template>
      {{#if @model.number}}
        <div class='tn'>
          <div class='tn-main'>
            {{#if @model.carrierCode}}
              <span class='tn-carrier'>{{@model.carrierCode}}</span>
            {{/if}}
            {{#if @model.trackingUrl}}
              <a
                class='tn-link'
                href={{@model.trackingUrl}}
                target='_blank'
                rel='noopener noreferrer'
              >{{@model.grouped}}</a>
            {{else}}
              <span class='tn-plain'>{{@model.grouped}}</span>
            {{/if}}
          </div>
          <CopyButton
            @textToCopy={{@model.number}}
            @tooltipText='Copy tracking number'
            @ariaLabel='Copy tracking number'
            @size='extra-small'
          />
        </div>
      {{else}}
        <span class='tn-empty'>No tracking number yet</span>
      {{/if}}

      <style scoped>
        .tn {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
          min-width: 0;
        }
        .tn-main {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xxs);
          min-width: 0;
        }
        .tn-carrier {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .tn-link,
        .tn-plain {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.85rem;
          letter-spacing: 0.03em;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tn-link {
          text-decoration: underline;
          text-underline-offset: 3px;
          text-decoration-color: color-mix(
            in oklch,
            var(--foreground, var(--boxel-dark)) 35%,
            transparent
          );
        }
        .tn-empty {
          color: var(--muted-foreground, var(--boxel-400));
          font-size: 0.85rem;
        }
      </style>
    </template>
  };
}

export default TrackingNumberField;
