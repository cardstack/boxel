import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getTestPrerenderer,
  stopTestPrerenderServer,
} from '#realm-server/tests/helpers/index';
import { ingestCard } from '../../src/commands/realm/ingest-card.ts';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupJwtTestProfile,
} from '../helpers/integration.ts';

// Ingest against a real realm server with real card indexing: the realm is
// seeded with an entry card whose dependency graph spans an ad hoc nested
// directory structure, plus files that must be left behind. The instance and
// Spec lookups go through the realm's actual search index (real prerenderer),
// not a stub.
//
//   widgets/gadget/gadget.gts            entry card (Gadget extends CardDef)
//     ├─ ./parts/widget-part             relative import, one level down
//     ├─ ../shared/format-utils          relative import, one level up
//     └─ https://cardstack.com/base/*    base-realm imports (left as refs)
//   widgets/gadget/gadget.test.gts       co-located test
//   Gadget/g1.json                       instance consuming the entry card
//   Spec/gadget.json                     card Spec whose ref → entry card
//
// Not ingested: an unreferenced module, an instance of that other card, and
// that other card's Spec.

const ownerUserId = '@cli-test:localhost';
const testRealmURL = new URL('http://127.0.0.1:4445/test/');

const REALM_FILES: Record<string, string> = {
  'widgets/gadget/gadget.gts': `
import StringField from '@cardstack/base/string';
import { CardDef, field, contains } from '@cardstack/base/card-api';
import { formatLabel } from '../shared/format-utils';
import { WidgetPart } from './parts/widget-part';

export class Gadget extends CardDef {
  static displayName = 'Gadget';
  @field title = contains(StringField);
}
`,
  'widgets/gadget/gadget.test.gts': `
import { Gadget } from './gadget';
export function runTests() {}
`,
  'widgets/gadget/parts/widget-part.gts': `
import GlimmerComponent from '@glimmer/component';
export class WidgetPart extends GlimmerComponent {}
`,
  'widgets/shared/format-utils.gts': `
export function formatLabel(value: string) { return value.toUpperCase(); }
`,
  'Gadget/g1.json': JSON.stringify({
    data: {
      type: 'card',
      attributes: { title: 'First gadget' },
      meta: {
        adoptsFrom: { module: '../widgets/gadget/gadget', name: 'Gadget' },
      },
    },
  }),
  'Spec/gadget.json': JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        specType: 'card',
        ref: { module: '../widgets/gadget/gadget', name: 'Gadget' },
        title: 'Gadget',
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/spec',
          name: 'Spec',
        },
      },
    },
  }),
  // --- everything below must NOT be ingested ---
  'standalone/clock.gts': `
import { CardDef } from '@cardstack/base/card-api';
export class Clock extends CardDef {
  static displayName = 'Clock';
}
`,
  'Clock/c1.json': JSON.stringify({
    data: {
      type: 'card',
      meta: {
        adoptsFrom: { module: '../standalone/clock', name: 'Clock' },
      },
    },
  }),
  'Spec/clock.json': JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        specType: 'card',
        ref: { module: '../standalone/clock', name: 'Clock' },
        title: 'Clock',
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/spec',
          name: 'Spec',
        },
      },
    },
  }),
};

const EXPECTED_INGESTED = [
  'Gadget/g1.json',
  'Spec/gadget.json',
  'widgets/gadget/gadget.gts',
  'widgets/gadget/gadget.test.gts',
  'widgets/gadget/parts/widget-part.gts',
  'widgets/shared/format-utils.gts',
];

let realmHref: string;
let profileManager: ProfileManager;
let cleanupProfile: () => void;
let localDir: string;
let result: { files: string[]; error?: string };

beforeAll(async () => {
  let { realms } = await startTestRealmServer({
    realms: [
      {
        realmURL: testRealmURL,
        fileSystem: REALM_FILES,
        permissions: {
          [ownerUserId]: ['read', 'write', 'realm-owner'],
        },
      },
    ],
    prerenderer: await getTestPrerenderer(),
    registerMatrixUser: false,
  });
  realmHref = realms.find((r) => r.url === testRealmURL.href)!.url;

  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupJwtTestProfile(profileManager, {
    user: ownerUserId,
    realmServerUrl: `${testRealmURL.origin}/`,
  });

  localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-ingest-int-'));
  result = await ingestCard(`${realmHref}widgets/gadget/gadget`, localDir, {
    realm: realmHref,
    profileManager,
  });
}, 600_000);

afterAll(async () => {
  if (localDir) {
    fs.rmSync(localDir, { recursive: true, force: true });
  }
  cleanupProfile?.();
  await stopTestRealmServer();
  // The prerender server is memoized per module registry, but vitest gives
  // each test file a fresh registry — the OS-level server would outlive this
  // file and the next suite's getTestPrerenderer() would hit EADDRINUSE.
  await stopTestPrerenderServer();
});

describe('realm ingest-card (integration)', () => {
  it('ingests the entry card graph: modules across nested dirs, test, instance, and Spec', () => {
    expect(result.error, `ingest failed: ${result.error}`).toBeUndefined();
    expect(result.files).toEqual(EXPECTED_INGESTED);
  });

  it('preserves the directory structure so relative refs still resolve', () => {
    for (let rel of EXPECTED_INGESTED) {
      let onDisk = path.join(localDir, rel);
      expect(fs.existsSync(onDisk), `${rel} should exist`).toBe(true);
      expect(fs.readFileSync(onDisk, 'utf8')).toBe(REALM_FILES[rel]);
    }
  });

  it('leaves unreferenced modules, unrelated instances, and unrelated Specs behind', () => {
    let notIngested = Object.keys(REALM_FILES).filter(
      (rel) => !EXPECTED_INGESTED.includes(rel),
    );
    expect(notIngested.length).toBeGreaterThan(0);
    for (let rel of notIngested) {
      expect(
        fs.existsSync(path.join(localDir, rel)),
        `${rel} should NOT exist`,
      ).toBe(false);
    }
  });

  it('ingests via non-URL @cardstack/ identifiers for both the card and --realm', async () => {
    // `@cardstack/<realm>/` resolves against the profile's realm-server
    // URL, so these identifiers name the same realm as realmHref. The card
    // identifier and the realm option resolve independently in ingestCard.
    let rriDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-ingest-rri-'));
    try {
      let rriResult = await ingestCard(
        '@cardstack/test/widgets/gadget/gadget',
        rriDir,
        {
          realm: '@cardstack/test/',
          profileManager,
        },
      );
      expect(
        rriResult.error,
        `ingest failed: ${rriResult.error}`,
      ).toBeUndefined();
      expect(rriResult.files).toEqual(EXPECTED_INGESTED);
    } finally {
      fs.rmSync(rriDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('does not copy base-realm modules the card imports', () => {
    // The copied source still imports the base realm by absolute URL; no
    // base-realm file is materialized locally.
    let gadget = fs.readFileSync(
      path.join(localDir, 'widgets/gadget/gadget.gts'),
      'utf8',
    );
    expect(gadget).toContain(`from '@cardstack/base/card-api'`);
    expect(fs.existsSync(path.join(localDir, 'base'))).toBe(false);
    expect(fs.existsSync(path.join(localDir, 'card-api.gts'))).toBe(false);
  });
});
