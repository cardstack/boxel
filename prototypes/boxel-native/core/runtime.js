import { LiteIndexer, REALM_URL } from './lite-indexer.js';
import { computedOnly } from './computed-fields.js';
import { RealmFs, SimulatedRemote, md5 } from './realm-fs.js';
import { Messenger } from './messenger.js';
import { planSync } from './sync-logic.js';

export { REALM_URL };

const MANIFEST_PATH = '.boxel-sync.json';

export class BoxelNativeRuntime {
  constructor(db) {
    this.db = db;
    this.fs = new RealmFs();
    this.remote = new SimulatedRemote();
    this.indexer = new LiteIndexer(db);
    this.messenger = new Messenger(db);
    this.online = false;
    this.lastPlan = [];
    this.lastSyncLog = [];
  }

  bootstrap(seed) {
    for (const [path, content] of Object.entries(seed.localFiles)) {
      this.fs.write(path, content, seed.localMtimeMs ?? Date.now() - 60_000);
    }
    for (const [path, content] of Object.entries(seed.remoteFiles)) {
      this.remote.write(
        path,
        content,
        seed.remoteMtimeSec ?? Math.floor(Date.now() / 1000),
      );
    }
    if (seed.manifest) {
      this.#saveManifest(seed.manifest);
    }
    this.reindex();
    for (const room of seed.rooms ?? []) {
      this.messenger.createRoom(room);
    }
    for (const msg of seed.messages ?? []) {
      const card = msg.cardAlias
        ? this.indexer.getByAlias(msg.cardAlias)
        : null;
      this.messenger.send({
        roomId: msg.roomId,
        sender: msg.sender,
        body: msg.body,
        cardUrl: card?.url ?? msg.cardUrl ?? null,
        syncState: msg.syncState ?? 'synced',
      });
    }
    this.lastPlan = this.previewSync('newest');
    return this.snapshot();
  }

  reindex() {
    return this.indexer.indexFilesystem(this.fs);
  }

  snapshot() {
    return {
      online: this.online,
      realmUrl: REALM_URL,
      index: this.indexer.stats(),
      files: this.fs
        .list()
        .filter((path) => !path.startsWith('.'))
        .map((path) => {
          const stat = this.fs.stat(path);
          return { path, hash: stat.hash, mtimeMs: stat.mtimeMs };
        }),
      cards: this.indexer.search().map(decorateCard),
      rooms: this.messenger.listRooms(),
      queuedMessages: this.messenger.queuedMessages().length,
      sync: {
        plan: this.lastPlan,
        log: this.lastSyncLog,
        summary: summarizePlan(this.lastPlan),
      },
    };
  }

  searchCards(q) {
    return this.searchIndex(q).cards;
  }

  searchIndex(q = '') {
    const result = this.indexer.searchIndex(q, this.fs);
    return {
      query: result.query,
      sql: result.sql,
      computedKeys: result.computedKeys,
      jsonSourceHits: result.jsonSourceHits,
      cards: result.rows.map(decorateCard),
      searched: 'boxel_index.search_doc',
      notSearched: 'realm JSON files',
    };
  }

  getCard(alias) {
    const row = this.indexer.getByAlias(alias);
    return row ? decorateCard(row) : null;
  }

  createPersonCard({ firstName, lastName, fileStem }) {
    const stem =
      fileStem ||
      `${firstName}-${lastName}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const relativePath = `${stem}.json`;
    const resource = {
      type: 'card',
      attributes: { firstName, lastName },
      meta: { adoptsFrom: { module: './person.gts', name: 'Person' } },
    };
    const content = JSON.stringify({ data: resource }, null, 2);
    this.fs.write(relativePath, content);
    this.reindex();
    this.lastPlan = this.previewSync('newest');
    return this.getCard(stem);
  }

  listMessages(roomId) {
    return this.messenger.listMessages(roomId).map((row) => ({
      ...row,
      card: row.card_url
        ? this.indexer.getByAlias(aliasFromUrl(row.card_url))
        : null,
    }));
  }

  sendMessage({ roomId, body, cardAlias, sender = 'you' }) {
    const card = cardAlias ? this.indexer.getByAlias(cardAlias) : null;
    const msg = this.messenger.send({
      roomId,
      sender,
      body,
      cardUrl: card?.url ?? null,
      syncState: this.online ? 'synced' : 'queued',
    });
    return {
      ...msg,
      card: card ? decorateCard(card) : null,
    };
  }

  setOnline(online) {
    this.online = Boolean(online);
    if (this.online) {
      for (const queued of this.messenger.queuedMessages()) {
        this.messenger.markSynced(queued.id);
      }
    }
    this.lastPlan = this.previewSync('newest');
    return this.snapshot();
  }

  #syncLocalHashes() {
    return new Map(
      [...this.fs.hashes()].filter(([path]) => !path.startsWith('.')),
    );
  }

  #syncLocalMtimes() {
    return new Map(
      [...this.fs.mtimes()].filter(([path]) => !path.startsWith('.')),
    );
  }

  previewSync(prefer = 'newest') {
    const manifest = this.#loadManifest();
    return planSync({
      localHashes: this.#syncLocalHashes(),
      localMtimes: this.#syncLocalMtimes(),
      remoteMtimes: this.remote.mtimes(),
      manifest,
      prefer,
    });
  }

  sync({ prefer = 'newest', deleteSync = false } = {}) {
    if (!this.online) {
      throw new Error(
        'Device is offline. File sync waits until the device is online, the same way `boxel realm sync` needs the realm server.',
      );
    }
    const manifest = this.#loadManifest() ?? {
      realmUrl: REALM_URL,
      files: {},
      remoteMtimes: {},
    };
    const plan = planSync({
      localHashes: this.#syncLocalHashes(),
      localMtimes: this.#syncLocalMtimes(),
      remoteMtimes: this.remote.mtimes(),
      manifest,
      prefer,
      deleteSync,
    });
    const log = [];
    const nextFiles = { ...manifest.files };
    const nextRemoteMtimes = { ...manifest.remoteMtimes };

    for (const item of plan) {
      const { relativePath, action } = item;
      if (action === 'noop') continue;
      if (action === 'conflict') {
        log.push({ relativePath, action, detail: 'skipped conflict' });
        continue;
      }
      if (action === 'push') {
        const content = this.fs.read(relativePath);
        this.remote.write(relativePath, content);
        nextFiles[relativePath] = md5(content);
        nextRemoteMtimes[relativePath] =
          this.remote.files.get(relativePath).mtimeSec;
        log.push({ relativePath, action, detail: 'uploaded to remote realm' });
      } else if (action === 'pull') {
        const content = this.remote.read(relativePath);
        const mtimeMs =
          (this.remote.files.get(relativePath)?.mtimeSec ?? 0) * 1000;
        this.fs.write(relativePath, content, mtimeMs);
        nextFiles[relativePath] = md5(content);
        nextRemoteMtimes[relativePath] =
          this.remote.files.get(relativePath).mtimeSec;
        log.push({ relativePath, action, detail: 'downloaded into local FS' });
      } else if (action === 'push-delete') {
        this.remote.delete(relativePath);
        delete nextFiles[relativePath];
        delete nextRemoteMtimes[relativePath];
        log.push({ relativePath, action, detail: 'deleted on remote' });
      } else if (action === 'pull-delete') {
        this.fs.delete(relativePath);
        delete nextFiles[relativePath];
        delete nextRemoteMtimes[relativePath];
        log.push({ relativePath, action, detail: 'deleted locally' });
      }
    }

    this.#saveManifest({
      realmUrl: REALM_URL,
      files: nextFiles,
      remoteMtimes: nextRemoteMtimes,
    });
    this.reindex();
    this.lastPlan = this.previewSync(prefer);
    this.lastSyncLog = log;
    return { plan, log, snapshot: this.snapshot() };
  }

  #loadManifest() {
    const raw = this.fs.read(MANIFEST_PATH);
    if (!raw) {
      const row = this.db.get(
        `SELECT files_json, remote_mtimes_json, realm_url FROM sync_manifest WHERE realm_url = ?`,
        [REALM_URL],
      );
      if (!row) return null;
      return {
        realmUrl: row.realm_url,
        files: JSON.parse(row.files_json),
        remoteMtimes: JSON.parse(row.remote_mtimes_json),
      };
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  #saveManifest(manifest) {
    this.fs.write(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    this.db.run(
      `INSERT INTO sync_manifest (realm_url, files_json, remote_mtimes_json)
       VALUES (?, ?, ?)
       ON CONFLICT(realm_url) DO UPDATE SET
         files_json = excluded.files_json,
         remote_mtimes_json = excluded.remote_mtimes_json`,
      [
        manifest.realmUrl,
        JSON.stringify(manifest.files ?? {}),
        JSON.stringify(manifest.remoteMtimes ?? {}),
      ],
    );
  }
}

function decorateCard(row) {
  const search = safeJson(row.search_doc) ?? {};
  const pristine = safeJson(row.pristine_doc) ?? {};
  return {
    url: row.url,
    fileAlias: row.file_alias,
    title: search._title || search.title || row.file_alias,
    handle: search.handle,
    initials: search.initials,
    fullName: search.fullName,
    computed: computedOnly(search),
    types: safeJson(row.types) ?? [],
    searchDoc: search,
    pristineDoc: pristine,
    indexedAt: row.indexed_at,
  };
}

function aliasFromUrl(url) {
  try {
    const path = new URL(url).pathname.replace(/^\//, '');
    return path.replace(/\.json$/, '');
  } catch {
    return url;
  }
}

function safeJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function summarizePlan(plan) {
  const counts = {
    push: 0,
    pull: 0,
    conflict: 0,
    noop: 0,
    'push-delete': 0,
    'pull-delete': 0,
  };
  for (const item of plan) {
    counts[item.action] = (counts[item.action] ?? 0) + 1;
  }
  return counts;
}
