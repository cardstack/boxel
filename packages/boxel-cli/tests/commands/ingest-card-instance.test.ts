import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ingestCard } from '../../src/commands/realm/ingest-card.js';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.js';
import type { ProfileManager } from '../../src/lib/profile-manager.js';

// Ingesting a single *instance* URL should copy that record + its module graph
// + the records it links to (transitively) — NOT every instance of its type
// (CS-11682). Fixture: a Garage links to two Tools; a second Garage and a third
// Tool are unrelated siblings that must be left behind.
//
//   garage.gts            Garage (linksToMany Tool)
//   tool.gts              Tool
//   Garage/g1.json        entry — links to Tool/t1, Tool/t2
//   Garage/g2.json        sibling Garage — links to Tool/t3   (NOT ingested)
//   Tool/t1.json, t2.json linked from g1                      (ingested)
//   Tool/t3.json          linked only from g2                 (NOT ingested)

const ROOT = 'https://realms.example.test/garage/';

const REALM_FILES: Record<string, string> = {
  'garage.gts': `
import { CardDef, field, linksToMany } from 'https://cardstack.com/base/card-api';
import { Tool } from './tool';
export class Garage extends CardDef {
  @field tools = linksToMany(() => Tool);
}
`,
  'tool.gts': `
import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
export class Tool extends CardDef {
  @field name = contains(StringField);
}
`,
  'Garage/g1.json': JSON.stringify({
    data: {
      type: 'card',
      meta: { adoptsFrom: { module: '../garage', name: 'Garage' } },
      relationships: {
        'tools.0': { links: { self: '../Tool/t1' } },
        'tools.1': { links: { self: '../Tool/t2' } },
      },
    },
  }),
  'Garage/g2.json': JSON.stringify({
    data: {
      type: 'card',
      meta: { adoptsFrom: { module: '../garage', name: 'Garage' } },
      relationships: { 'tools.0': { links: { self: '../Tool/t3' } } },
    },
  }),
  'Tool/t1.json': JSON.stringify({
    data: {
      type: 'card',
      attributes: { name: 'Hammer' },
      meta: { adoptsFrom: { module: '../tool', name: 'Tool' } },
    },
  }),
  'Tool/t2.json': JSON.stringify({
    data: {
      type: 'card',
      attributes: { name: 'Wrench' },
      meta: { adoptsFrom: { module: '../tool', name: 'Tool' } },
    },
  }),
  'Tool/t3.json': JSON.stringify({
    data: {
      type: 'card',
      attributes: { name: 'Drill' },
      meta: { adoptsFrom: { module: '../tool', name: 'Tool' } },
    },
  }),
};

const EXPECTED_INGESTED = [
  'Garage/g1.json',
  'Tool/t1.json',
  'Tool/t2.json',
  'garage.gts',
  'tool.gts',
];

function makeFakeAuthenticator(): RealmAuthenticator {
  let mtimes = Object.fromEntries(
    Object.keys(REALM_FILES).map((p, i) => [`${ROOT}${p}`, 1000 + i]),
  );
  return {
    async authedRealmFetch(input: string | URL | Request) {
      let url = String(input);
      if (url === `${ROOT}_mtimes`) {
        return new Response(
          JSON.stringify({ data: { attributes: { mtimes } } }),
          { status: 200 },
        );
      }
      let rel = url.startsWith(ROOT) ? url.slice(ROOT.length) : null;
      if (rel != null && REALM_FILES[rel] != null) {
        return new Response(REALM_FILES[rel], { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  } as RealmAuthenticator;
}

// No Catalog Spec in this fixture — the search returns nothing.
function makeFakeProfileManager(): ProfileManager {
  return {
    getActiveProfile() {
      return {
        profile: { realmServerUrl: 'https://realm-server.example.test' },
      };
    },
    async authedRealmServerFetch() {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  } as unknown as ProfileManager;
}

describe('ingest-card from an instance URL (CS-11682)', () => {
  let localDir: string;
  let result: { files: string[]; error?: string };

  beforeAll(async () => {
    localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-inst-'));
    result = await ingestCard(`${ROOT}Garage/g1`, localDir, {
      realm: ROOT,
      authenticator: makeFakeAuthenticator(),
      profileManager: makeFakeProfileManager(),
    });
  });

  afterAll(() => {
    fs.rmSync(localDir, { recursive: true, force: true });
  });

  it('copies the entry instance + its module graph + linked instances only', () => {
    expect(result.files).toEqual(EXPECTED_INGESTED);
  });

  it('does NOT copy unrelated siblings of the same type', () => {
    for (let rel of ['Garage/g2.json', 'Tool/t3.json']) {
      expect(
        fs.existsSync(path.join(localDir, rel)),
        `${rel} should NOT be ingested`,
      ).toBe(false);
    }
  });
});
