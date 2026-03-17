import {
  getAccessibleRealmTokens,
  matrixLogin,
  parseArgs,
  printJson,
  searchRealm,
  type SearchResultCard,
  type SearchSort,
} from './lib/boxel';

type TicketStatus = 'backlog' | 'in_progress' | 'blocked' | 'review' | 'done';
type TicketPriority = 'critical' | 'high' | 'medium' | 'low';

interface CompactTicket {
  id: string;
  ticketId: string | null;
  summary: string | null;
  status: TicketStatus | null;
  priority: TicketPriority | null;
  project: string | null;
}

function cardAttribute(card: SearchResultCard, key: string): unknown {
  return card.attributes?.[key];
}

function stringAttribute(card: SearchResultCard, key: string): string | null {
  let value = cardAttribute(card, key);
  return typeof value === 'string' ? value : null;
}

function enumAttribute<T extends string>(
  card: SearchResultCard,
  key: string,
  allowedValues: readonly T[],
): T | null {
  let value = cardAttribute(card, key);
  if (typeof value !== 'string') {
    return null;
  }

  return allowedValues.includes(value as T) ? (value as T) : null;
}

function cardProjectLink(card: SearchResultCard): string | null {
  let project = card.relationships?.project;
  if (typeof project !== 'object' || project === null) {
    return null;
  }
  let links = (project as { links?: unknown }).links;
  if (typeof links !== 'object' || links === null) {
    return null;
  }
  let self = (links as { self?: unknown }).self;
  return typeof self === 'string' ? self : null;
}

let args = parseArgs(process.argv.slice(2));
if (typeof args.realm !== 'string') {
  throw new Error(
    'Usage: npm run boxel:pick-ticket -- --realm <realm-url> [--module <ticket-schema-module-url>]',
  );
}

let realmUrl = args.realm;
let statusList = (
  typeof args.status === 'string' ? args.status : 'backlog,in_progress,review'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
let moduleUrl =
  typeof args.module === 'string'
    ? args.module
    : `${realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`}darkfactory-schema`;

let matrixAuth = await matrixLogin();
let realmTokens = await getAccessibleRealmTokens(matrixAuth);
let jwt = realmTokens[realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`];

let query: {
  filter: {
    type: { module: string; name: string };
    any: Array<{ eq: { status: string } }>;
    eq?: Record<string, string>;
  };
  sort: SearchSort[];
} = {
  filter: {
    type: {
      module: moduleUrl,
      name: 'Ticket',
    },
    any: statusList.map((status) => ({
      eq: { status },
    })),
  },
  sort: [
    {
      by: 'priority',
      direction: 'asc',
      on: {
        module: moduleUrl,
        name: 'Ticket',
      },
    },
    {
      by: 'updatedAt',
      direction: 'asc',
      on: {
        module: moduleUrl,
        name: 'Ticket',
      },
    },
  ],
};

if (typeof args.project === 'string') {
  query.filter.eq = {
    ...(query.filter.eq ?? {}),
    'project.id': args.project,
  };
}

if (typeof args.agent === 'string') {
  query.filter.eq = {
    ...(query.filter.eq ?? {}),
    'assignedAgent.id': args.agent,
  };
}

let results = await searchRealm({ realmUrl, jwt, query });
let compact: CompactTicket[] = (results.data ?? []).map((card) => ({
  id: card.id,
  ticketId: stringAttribute(card, 'ticketId'),
  summary: stringAttribute(card, 'summary'),
  status: enumAttribute(card, 'status', [
    'backlog',
    'in_progress',
    'blocked',
    'review',
    'done',
  ]),
  priority: enumAttribute(card, 'priority', [
    'critical',
    'high',
    'medium',
    'low',
  ]),
  project: cardProjectLink(card),
}));

printJson({
  count: compact.length,
  tickets: compact,
});
