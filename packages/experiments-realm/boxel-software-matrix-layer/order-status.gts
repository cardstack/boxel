import { Component, StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import ClipboardListIcon from '@cardstack/boxel-icons/clipboard-list';
import StatusChip, { type StatusStyle } from './fulfilment-status-chip';

// Order Status (OS) — the order's lifecycle, and the colour language that goes
// with it. The hues are exported from the same module that owns the enum so a
// board, a pill and an app all read one source instead of three copies.
//
// The amber run deepens as work progresses (processing → picking → packing),
// so a board column reads its position in the pipeline before you read a word.
export const ORDER_STATUSES: StatusStyle[] = [
  { value: 'pending', label: 'Pending', hue: '#3b82f6' },
  { value: 'processing', label: 'Processing', hue: '#f59e0b' },
  { value: 'awaiting_stock', label: 'Awaiting Stock', hue: '#ef4444' },
  { value: 'on_hold', label: 'On Hold', hue: '#6b7280' },
  { value: 'picking', label: 'Picking', hue: '#d97706' },
  { value: 'packing', label: 'Packing', hue: '#b45309' },
  { value: 'shipped', label: 'Shipped', hue: '#22c55e' },
  { value: 'delivered', label: 'Delivered', hue: '#15803d' },
  { value: 'cancelled', label: 'Cancelled', hue: '#6b7280' },
  { value: 'returned', label: 'Returned', hue: '#8b5cf6' },
];

// The stages an order passes through on the happy path, in order. Anything not
// listed here (on hold, cancelled, returned) is an exit, not a stage — which is
// why progress is measured against this list and not against ORDER_STATUSES.
export const ORDER_PIPELINE = [
  'pending',
  'processing',
  'picking',
  'packing',
  'shipped',
  'delivered',
];

export function orderStatusStyle(value?: string | null): StatusStyle {
  return (
    ORDER_STATUSES.find((s) => s.value === value) ?? {
      value: value ?? '',
      label: value ? value.replace(/_/g, ' ') : 'No status',
      hue: '',
    }
  );
}

// How far along the happy path this order is, 0–1. An order that has left the
// path (cancelled, on hold) reports 0 rather than a misleading fraction.
export function orderProgress(value?: string | null): number {
  let i = ORDER_PIPELINE.indexOf(value ?? '');
  if (i < 0) {
    return 0;
  }
  return (i + 1) / ORDER_PIPELINE.length;
}

const OrderStatusEnum = enumField(StringField, {
  options: ORDER_STATUSES.map((s) => ({ value: s.value, label: s.label })),
  displayName: 'Order Status',
  icon: ClipboardListIcon,
});

export class OrderStatusField extends OrderStatusEnum {
  static displayName = 'Order Status';
  static icon = ClipboardListIcon;

  static atom = class Atom extends Component<typeof OrderStatusField> {
    get style() {
      return orderStatusStyle(this.args.model as unknown as string);
    }
    <template>
      <StatusChip @label={{this.style.label}} @hue={{this.style.hue}} />
    </template>
  };

  static embedded = class Embedded extends Component<typeof OrderStatusField> {
    get style() {
      return orderStatusStyle(this.args.model as unknown as string);
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

export default OrderStatusField;
