import { Component, StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import TruckIcon from '@cardstack/boxel-icons/truck';
import StatusChip, { type StatusStyle } from './fulfilment-status-chip';

// Shipment Status (SS) — deliberately a different lifecycle from the order's.
// One order can carry two shipments at different stages, so collapsing the two
// enums into one would make a split shipment unrepresentable.
export const SHIPMENT_STATUSES: StatusStyle[] = [
  { value: 'label_created', label: 'Label Created', hue: '#6b7280' },
  { value: 'in_transit', label: 'In Transit', hue: '#3b82f6' },
  { value: 'out_for_delivery', label: 'Out for Delivery', hue: '#f59e0b' },
  { value: 'delivered', label: 'Delivered', hue: '#15803d' },
  { value: 'exception', label: 'Exception', hue: '#ef4444' },
  { value: 'returned_to_sender', label: 'Returned to Sender', hue: '#8b5cf6' },
];

// The scan sequence a package actually moves through. `exception` and
// `returned_to_sender` are off-path, so they are excluded here on purpose —
// a package sitting in exception has not progressed, and a rail that implied
// otherwise would be a lying affordance.
export const SHIPMENT_PIPELINE = [
  'label_created',
  'in_transit',
  'out_for_delivery',
  'delivered',
];

export function shipmentStatusStyle(value?: string | null): StatusStyle {
  return (
    SHIPMENT_STATUSES.find((s) => s.value === value) ?? {
      value: value ?? '',
      label: value ? value.replace(/_/g, ' ') : 'Not shipped',
      hue: '',
    }
  );
}

export function shipmentStageIndex(value?: string | null): number {
  return SHIPMENT_PIPELINE.indexOf(value ?? '');
}

export function isShipmentException(value?: string | null): boolean {
  return value === 'exception' || value === 'returned_to_sender';
}

const ShipmentStatusEnum = enumField(StringField, {
  options: SHIPMENT_STATUSES.map((s) => ({ value: s.value, label: s.label })),
  displayName: 'Shipment Status',
  icon: TruckIcon,
});

export class ShipmentStatusField extends ShipmentStatusEnum {
  static displayName = 'Shipment Status';
  static icon = TruckIcon;

  static atom = class Atom extends Component<typeof ShipmentStatusField> {
    get style() {
      return shipmentStatusStyle(this.args.model as unknown as string);
    }
    <template>
      <StatusChip @label={{this.style.label}} @hue={{this.style.hue}} />
    </template>
  };

  static embedded = class Embedded extends Component<
    typeof ShipmentStatusField
  > {
    get style() {
      return shipmentStatusStyle(this.args.model as unknown as string);
    }
    <template>
      <StatusChip
        @label={{this.style.label}}
        @hue={{this.style.hue}}
        @size='base'
      />
    </template>
  };
}

export default ShipmentStatusField;
