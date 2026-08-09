import {
  CardDef,
  Component,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import TableIcon from '@cardstack/boxel-icons/table';
import { Table, type TableColumn } from './table';
import { Invoice } from './invoice';
import { formatMoney, sumLineItems } from './money';

export class InvoiceTableDemo extends CardDef {
  static displayName = 'Invoice Table Demo';
  static icon = TableIcon;

  @field records = linksToMany(Invoice);

  static isolated = class Isolated extends Component<typeof InvoiceTableDemo> {
    columns: TableColumn[] = [
      {
        key: 'number',
        label: 'Invoice #',
        value: (item) => (item as Invoice).invoiceNumber,
      },
      {
        key: 'account',
        label: 'Account',
        value: (item) => (item as Invoice).account?.name,
      },
      {
        key: 'amount',
        label: 'Amount',
        align: 'right',
        value: (item) => {
          let { total, code } = sumLineItems((item as Invoice).lineItems);
          return total ? formatMoney(total, code) : undefined;
        },
        sortValue: (item) => sumLineItems((item as Invoice).lineItems).total,
      },
      {
        key: 'status',
        label: 'Status',
        value: (item) => (item as Invoice).status,
      },
      {
        key: 'due',
        label: 'Due',
        value: (item) => {
          let d = (item as Invoice).dueDate;
          return d ? new Date(d).toLocaleDateString() : undefined;
        },
        sortValue: (item) => {
          let d = (item as Invoice).dueDate;
          return d ? new Date(d).getTime() : undefined;
        },
      },
      {
        key: 'overdue',
        label: 'Days overdue',
        align: 'right',
        value: (item) => (item as Invoice).daysOverdue || undefined,
      },
    ];

    get items() {
      return ((this.args.model.records ?? []) as CardDef[]).filter(Boolean);
    }

    <template>
      <div class='demo'>
        <Table
          @items={{this.items}}
          @columns={{this.columns}}
          @emptyMessage='No invoices'
        />
      </div>
      <style scoped>
        .demo {
          padding: 1rem;
        }
      </style>
    </template>
  };
}
