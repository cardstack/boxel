import {
  getAccessibleRealmTokens,
  matrixLogin,
  parseArgs,
  printJson,
  searchRealm,
} from './lib/boxel.mjs';

let args = parseArgs(process.argv.slice(2));
let realmUrl = args.realm;
if (!realmUrl) {
  throw new Error(
    'Usage: npm run boxel:pick-ticket -- --realm <realm-url> [--module <ticket-schema-module-url>]',
  );
}

let statusList = (
  args.status ? String(args.status) : 'backlog,in_progress,review'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
let moduleUrl =
  args.module ??
  `${realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`}darkfactory-schema`;

let matrixAuth = await matrixLogin();
let realmTokens = await getAccessibleRealmTokens(matrixAuth);
let jwt = realmTokens[realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`];

let query = {
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

if (args.project) {
  query.filter.eq = {
    ...(query.filter.eq ?? {}),
    'project.id': args.project,
  };
}

if (args.agent) {
  query.filter.eq = {
    ...(query.filter.eq ?? {}),
    'assignedAgent.id': args.agent,
  };
}

let results = await searchRealm({ realmUrl, jwt, query });
let compact = (results.data ?? []).map((card) => ({
  id: card.id,
  ticketId: card.attributes?.ticketId,
  summary: card.attributes?.summary,
  status: card.attributes?.status,
  priority: card.attributes?.priority,
  project: card.relationships?.project?.links?.self ?? null,
}));

printJson({
  count: compact.length,
  tickets: compact,
});
