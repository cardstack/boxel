import { md5 } from './realm-fs.js';

const PERSON_MODULE = `import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';

export class Person extends CardDef {
  static displayName = 'Person';
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
}
`;

function personCard(firstName, lastName) {
  return `${JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: { firstName, lastName },
        meta: {
          adoptsFrom: { module: './person.gts', name: 'Person' },
        },
      },
    },
    null,
    2,
  )}\n`;
}

function noteCard(title, body) {
  return `${JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: { title, body, firstName: title },
        meta: {
          adoptsFrom: { module: './note.gts', name: 'Note' },
        },
      },
    },
    null,
    2,
  )}\n`;
}

const nimbusCard = `${JSON.stringify(
  {
    data: {
      type: 'card',
      attributes: { firstName: 'Nimbus', species: 'cat' },
      meta: { adoptsFrom: { module: './pet.gts', name: 'Pet' } },
    },
  },
  null,
  2,
)}\n`;

const maple = personCard('Maple', 'Grove');
const river = personCard('River', 'Stone');
const remoteMtimeSec = Math.floor(Date.now() / 1000) - 180;

const sharedFiles = {
  'person.gts': PERSON_MODULE,
  'maple-grove.json': maple,
  'river-stone.json': river,
  'nimbus.json': nimbusCard,
};

export const seed = {
  localMtimeMs: Date.now() - 90_000,
  remoteMtimeSec,
  localFiles: {
    ...sharedFiles,
    'offline-draft.json': noteCard(
      'Offline draft',
      'Written on device. Not on the remote realm yet.',
    ),
  },
  remoteFiles: {
    ...sharedFiles,
    'server-welcome.json': noteCard(
      'Server welcome',
      'This card exists only on the remote realm until you pull.',
    ),
  },
  manifest: {
    realmUrl: 'https://local.boxel/preview/',
    files: Object.fromEntries(
      Object.entries(sharedFiles).map(([path, content]) => [path, md5(content)]),
    ),
    remoteMtimes: Object.fromEntries(
      Object.keys(sharedFiles).map((path) => [path, remoteMtimeSec]),
    ),
  },
  rooms: [
    {
      id: 'realm-team',
      title: 'Realm team',
      subtitle: 'Cards stay on disk. The index is SQLite.',
    },
    {
      id: 'offline-notes',
      title: 'Offline notes',
      subtitle: 'Messages queue until you go online.',
    },
  ],
  messages: [
    {
      roomId: 'realm-team',
      sender: 'runtime',
      body: 'Local realm is a folder of JSON:API card files. The lite indexer writes boxel_index in SQLite.',
      syncState: 'synced',
    },
    {
      roomId: 'realm-team',
      sender: 'runtime',
      body: 'Open Maple Grove — that row came from maple-grove.json via json_extract on search_doc.',
      cardAlias: 'maple-grove',
      syncState: 'synced',
    },
    {
      roomId: 'offline-notes',
      sender: 'runtime',
      body: 'You are offline. Send a message or create a card, then use Sync the way `boxel realm sync --prefer-newest` would.',
      syncState: 'synced',
    },
  ],
};
