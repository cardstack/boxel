// The file the api-orders-sales-report evaluation starts from: one month of
// orders as a shop's orders API answers them, saved in the workspace at
// `api-reports/api/orders-2026-10.json`. It is JSON data, not a card, and it
// is large enough (420 orders) that the assistant reshapes it in a script
// rather than reading it into the conversation. The SalesReport definition
// the assistant fills stays committed in eval-realm/, linked from the
// evaluation's `initialFiles`.
//
// Everything is derived from fixed lists and a hash of each order number,
// never from a random source: the success criteria quote totals, so every run
// has to start from the same bytes. `expectedSalesReport` computes the totals
// those criteria quote from the same data.

import type { EvaluationSeed } from './index.ts';

export const API_ORDERS_PATH = 'api-reports/api/orders-2026-10.json';

const ORDER_COUNT = 420;
const FIRST_ORDER_NUMBER = 1001;

const PRODUCTS: [
  sku: string,
  title: string,
  productType: string,
  price: string,
][] = [
  ['CF-ETH-250', 'Ethiopia Guji 250 g', 'Coffee', '18.50'],
  ['CF-KEN-250', 'Kenya Nyeri 250 g', 'Coffee', '19.75'],
  ['CF-COL-1K', 'Colombia Huila 1 kg', 'Coffee', '54.00'],
  ['CF-BRA-250', 'Brazil Cerrado 250 g', 'Coffee', '14.25'],
  ['CF-DEC-250', 'Swiss Water Decaf 250 g', 'Coffee', '16.40'],
  ['TE-EGB-50', 'Earl Grey Bergamot 50 g', 'Tea', '9.80'],
  ['TE-SEN-50', 'Sencha Asahi 50 g', 'Tea', '12.60'],
  ['TE-OOL-50', 'Oolong Tieguanyin 50 g', 'Tea', '14.90'],
  ['TE-ROO-100', 'Rooibos Vanilla 100 g', 'Tea', '8.30'],
  ['BG-DRP-01', 'Ceramic Pour-Over Dripper', 'Brewing Gear', '32.00'],
  ['BG-GRD-01', 'Burr Hand Grinder', 'Brewing Gear', '89.00'],
  ['BG-KTL-01', 'Gooseneck Kettle', 'Brewing Gear', '64.50'],
  ['BG-FLT-100', 'Paper Filters 100', 'Brewing Gear', '6.20'],
  ['MC-STN-12', 'Stoneware Mug 12 oz', 'Mugs & Cups', '22.00'],
  ['MC-GLS-08', 'Double-Wall Glass 8 oz', 'Mugs & Cups', '17.40'],
  ['MC-TRV-16', 'Travel Tumbler 16 oz', 'Mugs & Cups', '29.90'],
  ['GC-025', 'Gift Card $25', 'Gift Cards', '25.00'],
  ['GC-050', 'Gift Card $50', 'Gift Cards', '50.00'],
];

const CUSTOMERS: [first: string, last: string][] = [
  ['Olivia', 'Grant'],
  ['Mateo', 'Rossi'],
  ['Amara', 'Nwosu'],
  ['Lukas', 'Weber'],
  ['Sofia', 'Lindqvist'],
  ['Kenji', 'Watanabe'],
  ['Grace', "O'Neill"],
  ['Rahul', 'Mehta'],
  ['Elif', 'Demir'],
  ['Noah', 'Fischer'],
  ['Chloe', 'Martin'],
  ['Tomas', 'Novak'],
  ['Ines', 'Carvalho'],
  ['Felix', 'Brandt'],
  ['Maya', 'Cohen'],
  ['Arjun', 'Rao'],
  ['Lea', 'Dubois'],
  ['Samuel', 'Okafor'],
  ['Hannah', 'Berg'],
  ['Diego', 'Alvarez'],
  ['Yuki', 'Tanaka'],
  ['Freya', 'Hansen'],
  ['Omar', 'Haddad'],
  ['Zoe', 'Papadopoulos'],
  ['Liam', 'Byrne'],
  ['Nina', 'Kowalski'],
  ['Pablo', 'Ortega'],
  ['Ava', 'Sorensen'],
  ['Ethan', 'Murphy'],
  ['Mira', 'Petrova'],
  ['Jonas', 'Keller'],
  ['Leila', 'Farah'],
  ['Victor', 'Moreau'],
  ['Ruby', 'Walsh'],
  ['Hugo', 'Laurent'],
  ['Isla', 'MacLeod'],
];

// Out of 100: paid 78, refunded 9, pending 8, voided 5. Only paid orders
// count toward the report.
function financialStatus(n: number): string {
  let bucket = hash(`status-${n}`) % 100;
  if (bucket < 78) {
    return 'paid';
  }
  if (bucket < 87) {
    return 'refunded';
  }
  if (bucket < 95) {
    return 'pending';
  }
  return 'voided';
}

// FNV-1a, for data that looks varied but never changes between runs.
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function cents(price: string): number {
  return Math.round(Number(price) * 100);
}

function money(totalCents: number): string {
  return (totalCents / 100).toFixed(2);
}

interface ApiLineItem {
  id: number;
  sku: string;
  title: string;
  product_type: string;
  quantity: number;
  price: string;
}

interface ApiOrder {
  id: number;
  name: string;
  created_at: string;
  financial_status: string;
  currency: string;
  total_price: string;
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
  };
  line_items: ApiLineItem[];
}

// The first six customers order far more often than the rest, the way a
// shop's regulars do, so the top five by spend are clear of the field.
function customerIndex(n: number): number {
  return hash(`regular-${n}`) % 3 === 0
    ? hash(`customer-${n}`) % 6
    : hash(`customer-${n}`) % CUSTOMERS.length;
}

function orders(): ApiOrder[] {
  let out: ApiOrder[] = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    let n = FIRST_ORDER_NUMBER + i;
    let c = customerIndex(n);
    let [first, last] = CUSTOMERS[c]!;
    let lineCount = 1 + (hash(`lines-${n}`) % 4);
    let lines: ApiLineItem[] = [];
    let used = new Set<number>();
    for (let l = 0; l < lineCount; l++) {
      let p = hash(`product-${n}-${l}`) % PRODUCTS.length;
      if (used.has(p)) {
        continue;
      }
      used.add(p);
      let [sku, title, productType, price] = PRODUCTS[p]!;
      lines.push({
        id: n * 10 + l,
        sku,
        title,
        product_type: productType,
        quantity: 1 + (hash(`qty-${n}-${l}`) % 3),
        price,
      });
    }
    let day = 1 + Math.floor((i * 31) / ORDER_COUNT);
    // Before 19:00 at -05:00, so every order falls in October 2026 in UTC
    // as well as in the shop's own time zone.
    let minute = hash(`time-${n}`) % (19 * 60);
    let createdAt = `2026-10-${String(day).padStart(2, '0')}T${String(
      Math.floor(minute / 60),
    ).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00-05:00`;
    out.push({
      id: 5_480_000_000 + n,
      name: `#${n}`,
      created_at: createdAt,
      financial_status: financialStatus(n),
      currency: 'USD',
      total_price: money(
        lines.reduce((sum, line) => sum + cents(line.price) * line.quantity, 0),
      ),
      customer: {
        id: 7_100_000 + c,
        first_name: first,
        last_name: last,
        email: `${first}.${last}`
          .toLowerCase()
          .replace(/[^a-z.]/g, '')
          .concat('@example.com'),
      },
      line_items: lines,
    });
  }
  return out;
}

// The response body as the API sends it: one page holding the whole month.
export function apiOrdersResponse() {
  return {
    orders: orders(),
    page_info: { has_next_page: false, end_cursor: null },
  };
}

// The totals the evaluation's success criteria quote, computed from the
// same orders.
export function expectedSalesReport() {
  let paid = orders().filter((o) => o.financial_status === 'paid');
  let byType = new Map<string, { units: number; cents: number }>();
  let byCustomer = new Map<
    string,
    { name: string; email: string; orders: number; cents: number }
  >();
  let units = 0;
  let revenueCents = 0;
  for (let order of paid) {
    let customer = byCustomer.get(order.customer.email) ?? {
      name: `${order.customer.first_name} ${order.customer.last_name}`,
      email: order.customer.email,
      orders: 0,
      cents: 0,
    };
    customer.orders += 1;
    customer.cents += cents(order.total_price);
    byCustomer.set(order.customer.email, customer);
    for (let line of order.line_items) {
      let type = byType.get(line.product_type) ?? { units: 0, cents: 0 };
      type.units += line.quantity;
      type.cents += cents(line.price) * line.quantity;
      byType.set(line.product_type, type);
      units += line.quantity;
      revenueCents += cents(line.price) * line.quantity;
    }
  }
  return {
    orders: orders().length,
    paidOrders: paid.length,
    unitsSold: units,
    revenue: money(revenueCents),
    productTypes: [...byType]
      .sort(([, a], [, b]) => b.cents - a.cents)
      .map(([productType, t]) => ({
        productType,
        units: t.units,
        revenue: money(t.cents),
      })),
    customers: [...byCustomer.values()]
      .sort((a, b) => b.cents - a.cents)
      .map((c) => ({ ...c, spend: money(c.cents) })),
  };
}

export function apiOrdersSeed(): EvaluationSeed {
  return {
    contents: { [API_ORDERS_PATH]: apiOrdersResponse() },
    initialCards: [],
    promptCards: [],
    expectedChangedCards: [],
  };
}
