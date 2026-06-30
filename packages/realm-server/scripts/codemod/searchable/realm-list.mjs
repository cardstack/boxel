// Print the deployed realms that have >=1 annotated def, one realm URL per line,
// for the deployed crawl. Excludes the realms handled via repo source edits
// (base/catalog/skills via @cardstack canonical keys; experiments/openrouter/
// software-factory/homepage by realm path). Published-copy hosts are flagged.
//
//   node realm-list.mjs <derivation.json> [--env staging|prod]
import { readFileSync } from 'node:fs';

let path = process.argv[2];
let { defs } = JSON.parse(readFileSync(path, 'utf8'));

// Repo-handled realm path segments (first path segment) — their defs are edited
// in a repo, not file-written. base/catalog/skills also use @cardstack keys.
let REPO_REALM_PATHS = new Set([
  'base',
  'catalog',
  'skills',
  'experiments',
  'openrouter',
  'software-factory',
  'boxel-homepage',
  'boxel_homepage_realm',
  'submissions',
]);

function realmOf(defKey) {
  // @cardstack/<realm>/... → repo-handled (base/catalog/skills); skip.
  if (defKey.startsWith('@cardstack/')) return null;
  let u;
  try {
    u = new URL(defKey);
  } catch {
    return null;
  }
  let segs = u.pathname.split('/').filter(Boolean);
  if (segs.length === 0) return null;
  // Published-copy hosts (e.g. *.boxel.build / *.boxel.dev) put the realm at a
  // shallower path; keep the convention origin + first two segments where
  // present, else origin root.
  let realmPath = segs.length >= 2 ? `${segs[0]}/${segs[1]}` : segs[0];
  return { url: `${u.origin}/${realmPath}/`, firstSeg: segs[0], host: u.host };
}

let byRealm = new Map(); // realmUrl -> {count, host}
for (let d of defs) {
  if (Object.keys(d.fields).length === 0) continue; // no annotation
  let r = realmOf(d.defKey);
  if (!r) continue;
  if (REPO_REALM_PATHS.has(r.firstSeg)) continue; // repo-handled
  let e = byRealm.get(r.url);
  if (!e) byRealm.set(r.url, (e = { count: 0, host: r.host }));
  e.count += 1;
}

let rows = [...byRealm.entries()].sort((a, b) => b[1].count - a[1].count);
for (let [url] of rows) console.log(url);
process.stderr.write(
  `${rows.length} realms with annotated defs (excluding repo-handled)\n`,
);
