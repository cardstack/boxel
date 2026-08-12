#!/usr/bin/env node
// Publish the Atlas Slice: a versioned vertical across six publishers.
//
// See `docs/atlas-slice-version-scenarios.md`. This driver exists because the
// slice's whole point is that pins record REAL HISTORY — a pack sealed against
// `northwind/records@^2.0.0` must carry 2.3.0 because 2.3.0 was the answer on
// the day it was published, not because a fixture said so. That is only true
// if the Versions go out in order, each one packed from a working tree that
// looked the way it looked at the time.
//
// So this writes the package's files, publishes, then writes the NEXT version
// over the top and publishes again. The realm's working tree ends at the last
// Version of everything, which is exactly what a real repository looks like;
// the history lives in the store, not in the tree.
//
// Usage:
//   node scripts/atlas-slice/publish.mjs              # everything, in order
//   node scripts/atlas-slice/publish.mjs cardstack/contracts
//   node scripts/atlas-slice/publish.mjs --from northwind/records@2.3.0

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jsonwebtoken from 'jsonwebtoken';

import { PLAN } from './plan.mjs';

const { sign } = jsonwebtoken;

const HERE = dirname(fileURLToPath(import.meta.url));
const REALM_DIR = join(HERE, '..', '..', '..', 'atlas-realm');

// Both hardcoded in `mise-tasks/services/realm-server` for local dev. The
// proposals route is gated on the REALM seed, not the realm-server one —
// getting that wrong costs three 401s before anyone thinks to read routes.ts.
const REALM_SECRET_SEED =
  process.env.REALM_SECRET_SEED ?? "shhh! it's a secret";
const SERVER =
  process.env.ATLAS_SERVER ?? 'https://realm-server.deck-at-rest-poc.localhost';
const REALM = `${SERVER}/atlas/`;

// A publish is one actor's decision, and the record keeps their name. Each
// publisher signs its own Versions, so the store's provenance reads like a
// supply chain rather than like one person wearing six hats — which matters
// for B12, where the question is whether anything checks that the actor owns
// the namespace they are publishing into.
function tokenFor(publisher) {
  return sign(
    { user: `@${publisher}:localhost`, sessionRoom: 'atlas-slice' },
    REALM_SECRET_SEED,
    { expiresIn: '1d' },
  );
}

async function post(name, publisher, body) {
  let res = await fetch(
    // REALM-RELATIVE. The realm governs the package namespace, so the door a
    // proposal goes through is what decides whose `cardstack/contracts` this
    // is — see `lib/package-store.ts`. A server-root address named nobody's
    // namespace and is gone.
    `${REALM}_package-proposals/${name}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenFor(publisher)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  let text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

// The manifest a package carries: what it is, what it exports, and the RANGES
// it accepts. The ranges are the interesting part — they are sealed into exact
// pins at publish time, and the range is kept beside the pin so a reader can
// see what the author would have accepted rather than only what they got.
function manifestFor(step) {
  return {
    deck: {
      publisher: step.publisher,
      packages: {
        [step.key]: {
          version: step.version,
          entry: '$DECK/index.gts',
          exports: { [`./${step.key}`]: '$DECK/index.gts' },
        },
      },
      ...(step.deps && Object.keys(step.deps).length
        ? { dependencies: step.deps }
        : {}),
    },
  };
}

async function writeVersion(step) {
  // `packages/<publisher>/<key>/`, not `<publisher>/<key>/`. A working tree is
  // realm content — the realm indexes it and its modules import bare
  // specifiers — so it needs a map of its own now that no realm-root map
  // supplies one, and the host only discovers maps under the conventional
  // roots. Keeping six publisher directories at the realm root also put the
  // publishing scaffolding in front of the cards, which is backwards.
  let dir = join(REALM_DIR, 'packages', step.publisher, step.key);
  // Cleared rather than merged: a version that DROPPED a file must not keep
  // shipping it because the previous write left it on disk. The pack is the
  // directory, so a stale sibling is a published stale sibling.
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'importmap.json'),
    `${JSON.stringify(manifestFor(step), null, 2)}\n`,
  );
  for (let [path, content] of Object.entries(step.files)) {
    let target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

// Is this Version already in the store? The plan is a HISTORY, so every run
// replays all of it; without this check a second run tries to publish 0.1.0
// again and the server rightly refuses ("does not follow"), burying the one
// new line in a wall of expected failures. Probing the served artefact rather
// than tracking state locally means the answer comes from the store itself —
// a store rebuilt from scratch republishes, which is what you want.
async function alreadyPublished(step) {
  let name = `${step.publisher}/${step.key}`;
  // Every pack in this slice declares `entry: '$DECK/index.gts'`, which is
  // served transpiled at index.js.
  let res = await fetch(`${REALM}_packages/${name}@${step.version}/index.js`, {
    method: 'HEAD',
  }).catch(() => undefined);
  return res?.status === 200;
}

async function publish(step) {
  let name = `${step.publisher}/${step.key}`;
  let label = `${name}@${step.version}`;
  if (await alreadyPublished(step)) {
    return { label, ok: true, skipped: true };
  }
  await writeVersion(step);

  let proposed = await post(name, step.publisher, {
    action: 'propose',
    from: { realm: REALM, package: step.key },
    body: step.changelog,
  });
  if (proposed.status !== 201) {
    return {
      label,
      ok: false,
      stage: 'propose',
      detail: JSON.stringify(proposed.json).slice(0, 500),
    };
  }
  let id = proposed.json?.proposal?.id;
  if (!id) {
    return { label, ok: false, stage: 'propose', detail: 'no proposal id' };
  }

  let accepted = await post(name, step.publisher, {
    action: 'accept',
    id,
    // The structural pass argues for a bump; a version the author chose on
    // purpose against that advice needs a reason on the record. The slice
    // publishes deliberately-wrong bumps (B6), so the reason is part of the
    // scenario rather than a way around the gate.
    ...(step.overrideReason ? { overrideReason: step.overrideReason } : {}),
  });
  if (accepted.status !== 200) {
    return {
      label,
      ok: false,
      stage: 'accept',
      detail: JSON.stringify(accepted.json).slice(0, 500),
    };
  }
  // THE LOCK, WRITTEN BACK. The pins are computed server-side at seal time, so
  // until now the working tree held only ranges — and a tree with ranges and no
  // pins cannot resolve its own imports when the realm indexes it. Copying the
  // sealed `imports` back means the tree develops against exactly what it last
  // published, which is what a lockfile is for.
  //
  // Best effort: a publish that succeeded is not undone by a failure to write
  // a convenience file, and the next run rewrites it anyway.
  await writeBackLock(name, step).catch((err) =>
    console.log(
      `  --   ${label} published, but its lock was not written back: ${err}`,
    ),
  );

  return {
    label,
    ok: true,
    pins: accepted.json?.pins ?? proposed.json?.proposal?.pins,
    invalidated: accepted.json?.invalidated,
  };
}

async function writeBackLock(name, step) {
  let res = await fetch(
    `${REALM}_packages/${name}@${step.version}/${'importmap.json'}`,
  );
  if (!res.ok) {
    return;
  }
  let sealed = await res.json();
  if (!sealed?.imports || Object.keys(sealed.imports).length === 0) {
    return;
  }
  let dir = join(REALM_DIR, 'packages', step.publisher, step.key);
  let mapPath = join(dir, 'importmap.json');
  let current = JSON.parse(await readFile(mapPath, 'utf8'));
  await writeFile(
    mapPath,
    `${JSON.stringify({ imports: sealed.imports, ...current }, null, 2)}\n`,
  );
}

async function main() {
  let args = process.argv.slice(2);
  let only = args.filter((a) => !a.startsWith('-'));
  let steps = only.length
    ? PLAN.filter((s) =>
        only.some(
          (o) =>
            `${s.publisher}/${s.key}` === o ||
            `${s.publisher}/${s.key}@${s.version}` === o ||
            s.publisher === o,
        ),
      )
    : PLAN;

  if (!steps.length) {
    console.error(`nothing in the plan matches ${only.join(', ')}`);
    process.exit(1);
  }

  let failures = 0;
  let skipped = 0;
  for (let step of steps) {
    let result = await publish(step);
    if (result.skipped) {
      skipped++;
      console.log(` --   ${result.label}  (already in the store)`);
    } else if (result.ok) {
      let pins = result.pins?.length
        ? ` [${result.pins
            .map((p) => `${p.key}@${p.version ?? p.spec}`)
            .join(', ')}]`
        : '';
      console.log(`  ok  ${result.label}${pins}`);
    } else {
      failures++;
      console.log(`FAIL  ${result.label}  (${result.stage}) ${result.detail}`);
    }
  }
  console.log(
    `\n${steps.length - failures - skipped}/${steps.length} published${
      skipped ? `, ${skipped} already there` : ''
    }${failures ? `, ${failures} failed` : ''}`,
  );
  process.exit(failures ? 1 : 0);
}

await main();
