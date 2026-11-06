// The cards the bulk-records evaluation starts from: a shop of 125 products
// and a helpdesk of 4 agents and 30 tickets, under `bulk-operations/`. Built
// here rather than committed, the way host tests hand a realm its contents,
// so the set can grow without hundreds of fixture files. The definitions
// they adopt from (`store/product.gts`, `helpdesk/support-ticket.gts`) stay
// committed in eval-realm/, linked from the evaluation's `initialFiles`.
//
// Everything is derived from fixed lists and a hash of each slug, never from
// a random source: the success criteria quote counts, ticket ids and one
// product's prices, so every run has to start from the same bytes.

import type { CardDocument } from '../realm-api.ts';

import type { EvaluationSeed } from './index.ts';

const STORE = 'bulk-operations/store';
const HELPDESK = 'bulk-operations/helpdesk';

// 22 regions × 5 processes = 110 coffee products. The prompt card,
// Ethiopia Yirgacheffe Washed, comes first.
const COFFEE_REGIONS: [country: string, region: string][] = [
  ['Ethiopia', 'Yirgacheffe'],
  ['Ethiopia', 'Guji'],
  ['Kenya', 'Nyeri'],
  ['Kenya', 'Kirinyaga'],
  ['Colombia', 'Huila'],
  ['Colombia', 'Narino'],
  ['Brazil', 'Mogiana'],
  ['Brazil', 'Cerrado Mineiro'],
  ['Guatemala', 'Huehuetenango'],
  ['Guatemala', 'Antigua'],
  ['Costa Rica', 'Tarrazu'],
  ['Honduras', 'Marcala'],
  ['El Salvador', 'Santa Ana'],
  ['Peru', 'Cajamarca'],
  ['Bolivia', 'Caranavi'],
  ['Rwanda', 'Huye'],
  ['Burundi', 'Ngozi'],
  ['Indonesia', 'Toraja'],
  ['India', 'Chikmagalur'],
  ['Ecuador', 'Loja'],
  ['Mexico', 'Chiapas'],
  ['Zambia', 'Muchinga'],
];
const PROCESSES = ['Washed', 'Natural', 'Honey', 'Anaerobic', 'Decaf'];

const TEAS: [name: string, gramsSmall: number][] = [
  ['Assam Breakfast', 50],
  ['Darjeeling First Flush', 50],
  ['Earl Grey Bergamot', 50],
  ['Ceylon Uva', 50],
  ['Jasmine Silver Needle', 25],
  ['Gyokuro Yame', 25],
  ['Sencha Asahi', 50],
  ['Oolong Tieguanyin', 50],
  ['Pu-erh Menghai', 50],
  ['Rooibos Vanilla', 50],
];

const EQUIPMENT = [
  'Ceramic Pour-Over Dripper',
  'Burr Hand Grinder',
  'Gooseneck Kettle',
  'Glass Carafe 600 ml',
  'Paper Filters 100',
];

const AGENTS: [slug: string, fullName: string, team: string][] = [
  ['sam-rivera', 'Sam Rivera', 'Tier 2'],
  ['priya-shah', 'Priya Shah', 'Tier 2'],
  ['diego-alvarez', 'Diego Alvarez', 'Tier 1'],
  ['hana-kim', 'Hana Kim', 'Tier 1'],
];

// Sam Rivera's tickets, which the second prompt and its criteria name.
const SAM_OPEN = [
  5101, 5107, 5116, 5134, 5137, 5155, 5158, 5164, 5167, 5170, 5173, 5182,
];
const SAM_CLOSED = [5104, 5113, 5125, 5179];
const OTHER_AGENTS = ['priya-shah', 'diego-alvarez', 'hana-kim'];

const TICKET_SUBJECTS = [
  'Cannot reset password from the mobile app',
  'Invoice shows the wrong billing address',
  'Export to CSV times out on large reports',
  'Two-factor codes arrive late',
  'Webhook retries flood our endpoint',
  'SSO login loops back to the sign-in page',
  'Charged twice for the annual plan',
  'Dashboard widgets do not load in Safari',
  'API returns 500 on bulk create',
  'Need to transfer account ownership',
  'Email notifications go to spam',
  'Calendar sync drops recurring events',
  'Cannot remove a deactivated user',
  'Report totals differ from the invoice',
  'Upload fails for files over 20 MB',
  'Search ignores accented characters',
  'Request to delete my personal data',
  'Mobile app crashes on Android 15',
  'Timezone wrong on scheduled reports',
  'Integration token expired without warning',
  "Need a copy of last year's invoices",
  'Seat count not updated after upgrade',
  'Slack alerts stopped arriving',
  'Custom domain certificate not renewing',
  'Bulk import skips rows with commas',
  'Audit log missing admin actions',
  'Cannot change plan currency',
  'Shared link opens a blank page',
  'Password policy too strict for contractors',
  'Duplicate contacts after the merge',
];
const REQUESTERS = [
  'Olivia Grant',
  'Mateo Rossi',
  'Amara Nwosu',
  'Lukas Weber',
  'Sofia Lindqvist',
  'Kenji Watanabe',
  "Grace O'Neill",
  'Rahul Mehta',
  'Elif Demir',
  'Noah Fischer',
];

const EXPECTED = {
  coffee: 110,
  coffeeVariants: 260,
  tea: 10,
  equipment: 5,
  agents: 4,
  tickets: 30,
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// FNV-1a, for prices that look varied but never change between runs.
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A price in whole cents between `min` and `max` dollars. Cents never end in
// 5, so price × 1.1 never lands on a half cent and rounding it has no tie.
function price(key: string, min: number, max: number): number {
  let cents = min * 100 + (hash(key) % ((max - min) * 100));
  if (cents % 10 === 5) {
    cents += 1;
  }
  return cents / 100;
}

function card(
  module: string,
  name: string,
  attributes: Record<string, unknown>,
  relationships: Record<string, { links: { self: string | null } }> = {},
): CardDocument {
  return {
    data: {
      type: 'card',
      attributes: {
        cardInfo: {
          name: null,
          summary: null,
          cardThumbnailURL: null,
          notes: null,
        },
        ...attributes,
      },
      relationships: {
        'cardInfo.theme': { links: { self: null } },
        ...relationships,
      },
      meta: { adoptsFrom: { module, name } },
    },
  };
}

function product(
  name: string,
  category: string,
  origin: string | null,
  variants: { sku: string; size: string; price: number }[],
) {
  return card('../product', 'Product', { name, category, origin, variants });
}

function coffeeProducts(): [slug: string, doc: CardDocument][] {
  let out: [string, CardDocument][] = [];
  for (let [country, region] of COFFEE_REGIONS) {
    for (let process of PROCESSES) {
      let index = out.length;
      let name = `${country} ${region} ${process}`;
      let slug = slugify(name);
      let sku = `CF-${String(index + 1).padStart(3, '0')}`;
      // 40 of the 110 also come in 1 kg.
      let sizes: [size: string, skuSuffix: string, min: number, max: number][] =
        [
          ['250 g', '250', 12, 22],
          ['500 g', '500', 22, 40],
        ];
      if (index % 11 < 4) {
        sizes.push(['1 kg', '1KG', 40, 72]);
      }
      out.push([
        slug,
        product(
          name,
          'coffee',
          `${region}, ${country}`,
          sizes.map(([size, suffix, min, max]) => ({
            sku: `${sku}-${suffix}`,
            size,
            price: price(`${slug}:${size}`, min, max),
          })),
        ),
      ]);
    }
  }
  return out;
}

function teaProducts(): [slug: string, doc: CardDocument][] {
  return TEAS.map(([name, grams], index) => {
    let slug = slugify(name);
    let sku = `TE-${String(index + 1).padStart(3, '0')}`;
    return [
      slug,
      product(name, 'tea', null, [
        {
          sku: `${sku}-${String(grams).padStart(3, '0')}`,
          size: `${grams} g`,
          price: price(`${slug}:small`, 8, 16),
        },
        {
          sku: `${sku}-${String(grams * 2).padStart(3, '0')}`,
          size: `${grams * 2} g`,
          price: price(`${slug}:large`, 16, 30),
        },
      ]),
    ];
  });
}

function equipmentProducts(): [slug: string, doc: CardDocument][] {
  return EQUIPMENT.map((name, index) => {
    let slug = slugify(name);
    return [
      slug,
      product(name, 'equipment', null, [
        {
          sku: `EQ-${String(index + 1).padStart(3, '0')}`,
          size: 'one size',
          price: price(slug, 6, 90),
        },
      ]),
    ];
  });
}

function agents(): [slug: string, doc: CardDocument][] {
  return AGENTS.map(([slug, fullName, team]) => [
    slug,
    card('../support-ticket', 'Agent', {
      fullName,
      email: `${slug.replace('-', '.')}@support.example.com`,
      team,
    }),
  ]);
}

function tickets(): [slug: string, doc: CardDocument][] {
  let others = 0;
  return TICKET_SUBJECTS.map((subject, index) => {
    let id = 5101 + index * 3;
    let assignee: string;
    let status: string;
    if (SAM_OPEN.includes(id)) {
      [assignee, status] = ['sam-rivera', 'open'];
    } else if (SAM_CLOSED.includes(id)) {
      [assignee, status] = ['sam-rivera', 'closed'];
    } else {
      assignee = OTHER_AGENTS[others % OTHER_AGENTS.length];
      status = others % 2 === 0 ? 'open' : 'closed';
      others++;
    }
    return [
      `ticket-${id}`,
      card(
        '../support-ticket',
        'SupportTicket',
        {
          subject,
          requester: REQUESTERS[index % REQUESTERS.length],
          status,
          openedOn: `2026-10-${String(1 + ((index * 7) % 26)).padStart(2, '0')}`,
        },
        { assignee: { links: { self: `../Agent/${assignee}` } } },
      ),
    ];
  });
}

function check(what: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(
      `bulk-records seed: expected ${expected} ${what}, built ${actual}`,
    );
  }
}

export function bulkRecordsSeed(): EvaluationSeed {
  let coffee = coffeeProducts();
  let tea = teaProducts();
  let equipment = equipmentProducts();
  let agentCards = agents();
  let ticketCards = tickets();

  check('coffee products', coffee.length, EXPECTED.coffee);
  check(
    'coffee variants',
    coffee.reduce(
      (sum, [, doc]) =>
        sum + (doc.data.attributes!.variants as unknown[]).length,
      0,
    ),
    EXPECTED.coffeeVariants,
  );
  check('tea products', tea.length, EXPECTED.tea);
  check('equipment products', equipment.length, EXPECTED.equipment);
  check('agents', agentCards.length, EXPECTED.agents);
  check('tickets', ticketCards.length, EXPECTED.tickets);
  check(
    "Sam's open and closed tickets",
    ticketCards.filter(
      ([, doc]) =>
        doc.data.relationships?.assignee?.links?.self === '../Agent/sam-rivera',
    ).length,
    SAM_OPEN.length + SAM_CLOSED.length,
  );

  let contents: Record<string, CardDocument> = {};
  for (let [slug, doc] of [...coffee, ...tea, ...equipment]) {
    contents[`${STORE}/Product/${slug}.json`] = doc;
  }
  for (let [slug, doc] of agentCards) {
    contents[`${HELPDESK}/Agent/${slug}.json`] = doc;
  }
  for (let [slug, doc] of ticketCards) {
    contents[`${HELPDESK}/SupportTicket/${slug}.json`] = doc;
  }

  // The coffee set's edges in name order, and its middle, so a run that
  // stops after the first search page, or skips the last, is caught.
  let coffeeSlugs = coffee.map(([slug]) => slug).sort();
  return {
    contents,
    initialCards: [
      `${STORE}/Product/ethiopia-yirgacheffe-washed`,
      `${HELPDESK}/Agent/sam-rivera`,
    ],
    promptCards: [
      `${STORE}/Product/ethiopia-yirgacheffe-washed`,
      `${HELPDESK}/Agent/sam-rivera`,
    ],
    expectedChangedCards: [
      `${STORE}/Product/ethiopia-yirgacheffe-washed`,
      `${STORE}/Product/${coffeeSlugs[0]}`,
      `${STORE}/Product/${coffeeSlugs[Math.floor(coffeeSlugs.length / 2)]}`,
      `${STORE}/Product/${coffeeSlugs[coffeeSlugs.length - 1]}`,
      `${HELPDESK}/SupportTicket/ticket-5101`,
      `${HELPDESK}/SupportTicket/ticket-5158`,
      `${HELPDESK}/SupportTicket/ticket-5182`,
    ],
  };
}
