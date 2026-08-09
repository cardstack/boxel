#!/usr/bin/env node
/* eslint-env node */

// Two majors of one library, live, in one process, chosen by importer.
//
// This is the thing that cannot be done today. Boxel's virtual network
// resolves a bare specifier through a flat prefix table with no importer
// argument, so `palette` means exactly one thing per realm; the only way to
// get a second version has been to copy the whole tree. That is why "remix"
// currently means duplicating ~180 files.
//
// What runs below:
//
//   1. A decklist — `imports` plus one `scopes` entry — is loaded into a
//      real VirtualNetwork.
//   2. The SAME specifier, `palette`, is resolved twice with two different
//      importers, and comes back as two different versioned URLs.
//   3. Both URLs are fetched from the running realm server and EXECUTED.
//      v1's pick() takes an index, v2's takes a name — incompatible APIs,
//      both live, at the same time.
//
//   node scripts/demo-coexistence.mjs [realm-server-base-url]

import { VirtualNetwork } from '@cardstack/runtime-common';

let base = process.argv[2] ?? 'https://realm-server.deck-at-rest-poc.localhost';
let SERVE = `${base}/_packages`;
let REALM = `${base}/acme/`;

// The dev realm server presents the local mkcert leaf. This demo talks to it
// directly rather than through a configured client, so trust it explicitly
// for this process only.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let vn = new VirtualNetwork(fetch);
vn.addDecklist({
  imports: { palette: `${SERVE}/lib/palette@2.0.0/index.js` },
  scopes: {
    [`${REALM}legacy-viewer/`]: {
      palette: `${SERVE}/lib/palette@1.0.0/index.js`,
    },
  },
});

let gallery = `${REALM}gallery/scene.gts`;
let legacy = `${REALM}legacy-viewer/scene.gts`;

console.log('one specifier, two importers\n');
for (let importer of [gallery, legacy]) {
  console.log(`  import { pick } from 'palette'`);
  console.log(`    asked by  ${importer}`);
  console.log(`    resolves  ${vn.resolveImport('palette', importer)}\n`);
}

// Execute both. Node will not import an https: URL, so fetch the bytes and
// hand them to a data: URL — the modules are real, only the loading is
// improvised.
async function load(url) {
  let res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status}`);
  }
  let immutable = res.headers.get('cache-control') ?? '(none)';
  let source = await res.text();
  let mod = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  return { mod, immutable, bytes: source.length };
}

let v2 = await load(vn.resolveImport('palette', gallery));
let v1 = await load(vn.resolveImport('palette', legacy));

console.log('both loaded, in this one process:\n');
console.log(
  `  gallery       palette v${v2.mod.VERSION}  pick('amber') -> ${v2.mod.pick(
    'amber',
  )}   names(): ${v2.mod.names().join(' ')}`,
);
console.log(
  `  legacy-viewer palette v${v1.mod.VERSION}  pick(0)       -> ${v1.mod.pick(
    0,
  )}`,
);

console.log('\nthe APIs are incompatible, which is the point:');
console.log(
  `  v1.pick('amber') -> ${JSON.stringify(
    v1.mod.pick('amber'),
  )}   (v1 wants an index)`,
);
console.log(
  `  v2.pick(0)       -> ${JSON.stringify(v2.mod.pick(0))}   (v2 wants a name)`,
);

console.log('\nserved as:');
console.log(`  v1  ${v1.bytes} bytes  cache-control: ${v1.immutable}`);
console.log(`  v2  ${v2.bytes} bytes  cache-control: ${v2.immutable}`);
console.log(
  '\nNeither realm copied a tree. The difference is four lines of decklist.',
);
