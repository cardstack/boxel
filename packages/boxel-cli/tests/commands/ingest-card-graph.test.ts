import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ingestCard } from '../../src/commands/realm/ingest-card.js';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.js';
import type { ProfileManager } from '../../src/lib/profile-manager.js';

// End-to-end ingest against an in-memory fake realm: the real `ingestCard()`
// runs unmodified, with the realm's HTTP surface (`_mtimes`, file fetches)
// and the realm-server search endpoint stubbed. The fixture has an ad hoc
// nested directory structure so the assertions prove relative refs survive:
//
//   widgets/gadget/gadget.gts            entry card (Gadget extends CardDef)
//     ├─ ./parts/widget-part             relative import, one level down
//     ├─ ../shared/format-utils          relative import, one level up
//     ├─ ../shared/tuning-types          TYPE-ONLY import (erased at runtime)
//     └─ https://cardstack.com/base/*    base-realm imports (left as refs)
//   widgets/gadget/gadget.test.gts       co-located test
//   Gadget/g1.json                       instance consuming the entry card
//   Spec/gadget.json                     card Spec whose ref → entry card
//
// Plus files that must NOT be ingested: an unreferenced module, an instance
// of a different card, that card's Spec, and a component-type Spec that
// points at a seeded module.

const ROOT = 'https://realms.example.test/workshop/';
const GADGET_MODULE_ABS = `${ROOT}widgets/gadget/gadget`;

const REALM_FILES: Record<string, string> = {
  'widgets/gadget/gadget.gts': `
import StringField from '@cardstack/base/string';
import { CardDef, field, contains } from '@cardstack/base/card-api';
import { formatLabel } from '../shared/format-utils';
import { WidgetPart } from './parts/widget-part';
import type { GadgetTuning } from '../shared/tuning-types';

export class Gadget extends CardDef {
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
  'widgets/shared/tuning-types.gts': `
export interface GadgetTuning { level: number; }
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
export class Clock extends CardDef {}
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
      },
    },
  }),
  'Spec/widget-part-component.json': JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        specType: 'component',
        ref: {
          module: '../widgets/gadget/parts/widget-part',
          name: 'WidgetPart',
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
  'widgets/shared/tuning-types.gts',
];

function makeFakeAuthenticator(fetchedUrls: string[]): RealmAuthenticator {
  let mtimes = Object.fromEntries(
    Object.keys(REALM_FILES).map((p, i) => [`${ROOT}${p}`, 1000 + i]),
  );
  return {
    async authedRealmFetch(input: string | URL | Request, init?: RequestInit) {
      let url = String(input);
      fetchedUrls.push(url);
      if (url === `${ROOT}_mtimes`) {
        return new Response(
          JSON.stringify({ data: { attributes: { mtimes } } }),
          {
            status: 200,
          },
        );
      }
      // The ingester discovers instances + Specs via the source realm's own
      // `_search` endpoint (a data-only QUERY request), not the
      // profile-scoped federated search — so a shared/published source realm
      // is reachable.
      if (url === `${ROOT}_search`) {
        let cards = fakeSearchData(String(init?.body ?? '{}'));
        return new Response(JSON.stringify(searchEntryDoc(cards)), {
          status: 200,
        });
      }
      let rel = url.startsWith(ROOT) ? url.slice(ROOT.length) : null;
      if (rel != null && REALM_FILES[rel] != null) {
        return new Response(REALM_FILES[rel], { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  };
}

// The cards the source realm matches for the two shapes the ingester issues:
// instances of the entry card's exported classes, and all base-realm Spec
// cards (filtered by specType + ref in the ingester itself). The type anchor
// arrives `item.`-addressed (`filter['item.on']`) — the entry grammar
// `_search` speaks.
function fakeSearchData(
  bodyStr: string,
): { id: string; attributes?: unknown }[] {
  let body = JSON.parse(bodyStr) as {
    filter?: { 'item.on'?: { module?: string; name?: string } };
  };
  let on = body.filter?.['item.on'];
  if (on?.module === 'https://cardstack.com/base/spec') {
    return [
      {
        id: `${ROOT}Spec/gadget`,
        attributes: {
          specType: 'card',
          ref: { module: '../widgets/gadget/gadget', name: 'Gadget' },
        },
      },
      {
        id: `${ROOT}Spec/clock`,
        attributes: {
          specType: 'card',
          ref: { module: '../standalone/clock', name: 'Clock' },
        },
      },
      {
        id: `${ROOT}Spec/widget-part-component`,
        attributes: {
          specType: 'component',
          ref: {
            module: '../widgets/gadget/parts/widget-part',
            name: 'WidgetPart',
          },
        },
      },
    ];
  }
  if (on?.module === GADGET_MODULE_ABS && on?.name === 'Gadget') {
    return [{ id: `${ROOT}Gadget/g1` }];
  }
  return [];
}

// Wrap matched cards as a data-only entry document — one entry per card
// linking its `item`, with the card resources themselves in `included` (the
// shape `_search` returns; a published realm carries its matches the same
// way, so the ingester needs no published-vs-normal special-casing).
function searchEntryDoc(cards: { id: string; attributes?: unknown }[]) {
  return {
    data: cards.map((card) => ({
      id: card.id,
      relationships: { item: { data: { type: 'card', id: card.id } } },
    })),
    included: cards.map((card) => ({ type: 'card', ...card })),
    meta: { page: { total: cards.length } },
  };
}

// Auth is supplied directly via `authenticator`, so the profile manager is
// only here to satisfy ingestCard's option plumbing — search no longer goes
// through it.
function makeFakeProfileManager(): ProfileManager {
  return {
    getActiveProfile() {
      return {
        profile: { realmServerUrl: 'https://realm-server.example.test' },
      };
    },
  } as unknown as ProfileManager;
}

describe('ingest-card graph (fake realm end-to-end)', () => {
  let localDir: string;
  let fetchedUrls: string[] = [];
  let result: { files: string[]; error?: string };

  beforeAll(async () => {
    localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-graph-'));
    result = await ingestCard(GADGET_MODULE_ABS, localDir, {
      realm: ROOT,
      authenticator: makeFakeAuthenticator(fetchedUrls),
      profileManager: makeFakeProfileManager(),
    });
  });

  afterAll(() => {
    fs.rmSync(localDir, { recursive: true, force: true });
  });

  it('ingests exactly the entry card graph: modules (incl. type-only deps), test, instance, and card Spec', () => {
    expect(result.error).toBeUndefined();
    expect(result.files).toEqual(EXPECTED_INGESTED);
  });

  it('preserves the directory structure so relative refs still resolve', () => {
    for (let rel of EXPECTED_INGESTED) {
      let onDisk = path.join(localDir, rel);
      expect(fs.existsSync(onDisk), `${rel} should exist`).toBe(true);
      expect(fs.readFileSync(onDisk, 'utf8')).toBe(REALM_FILES[rel]);
    }
    // The copied source still uses its relative imports verbatim, and the
    // files those imports point at exist at the matching relative locations.
    let gadget = fs.readFileSync(
      path.join(localDir, 'widgets/gadget/gadget.gts'),
      'utf8',
    );
    expect(gadget).toContain(`from '../shared/format-utils'`);
    expect(gadget).toContain(`from './parts/widget-part'`);
  });

  it('does not ingest unreferenced modules, unrelated instances, unrelated Specs, or component Specs', () => {
    // Every fixture file that isn't expected output must stay behind — so any
    // file added to REALM_FILES later is automatically covered.
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

  it('leaves base-realm imports as references — nothing outside the source realm is fetched', () => {
    expect(fetchedUrls.length).toBeGreaterThan(0);
    for (let url of fetchedUrls) {
      expect(
        url.startsWith(ROOT),
        `unexpected fetch outside realm: ${url}`,
      ).toBe(true);
    }
  });
});
