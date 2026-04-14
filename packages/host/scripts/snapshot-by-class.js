#!/usr/bin/env node
/**
 * Count heap-snapshot nodes by constructor name (type::name) and show deltas.
 * Strips long body strings so output is scannable. Different from snapshot-diff:
 * sorts by count-delta only, shows just the constructor key, truncates.
 */
const fs = require('fs');

function load(path) {
  let snap = JSON.parse(fs.readFileSync(path, 'utf8'));
  let meta = snap.snapshot.meta;
  let nodeFields = meta.node_fields;
  let nodeTypes = meta.node_types[nodeFields.indexOf('type')];
  let nameIdx = nodeFields.indexOf('name');
  let typeIdx = nodeFields.indexOf('type');
  let sizeIdx = nodeFields.indexOf('self_size');
  let fc = nodeFields.length;
  let nodes = snap.nodes;
  let strings = snap.strings;
  let counts = new Map();
  for (let i = 0; i < nodes.length; i += fc) {
    let type = nodeTypes[nodes[i + typeIdx]];
    let name = strings[nodes[i + nameIdx]];
    // truncate long names
    let shortName =
      name && name.length > 120 ? name.slice(0, 80) + '…' : name || '(anon)';
    let key = `${type}::${shortName}`;
    let c = counts.get(key);
    if (!c) counts.set(key, { count: 0, size: 0 });
    c = counts.get(key);
    c.count++;
    c.size += nodes[i + sizeIdx];
  }
  return counts;
}

function main() {
  let [a, b, pattern] = process.argv.slice(2);
  if (!a || !b) {
    console.error(
      'usage: snapshot-by-class <a.heapsnapshot> <b.heapsnapshot> [name-pattern]',
    );
    process.exit(2);
  }
  let re = pattern ? new RegExp(pattern, 'i') : null;
  console.log(`loading ${a}...`);
  let ca = load(a);
  console.log(`loading ${b}...`);
  let cb = load(b);
  let all = new Set([...ca.keys(), ...cb.keys()]);
  let rows = [];
  for (let key of all) {
    if (re && !re.test(key)) continue;
    let av = ca.get(key) || { count: 0, size: 0 };
    let bv = cb.get(key) || { count: 0, size: 0 };
    rows.push({
      key,
      dCount: bv.count - av.count,
      dSize: bv.size - av.size,
      aCount: av.count,
      bCount: bv.count,
    });
  }
  rows
    .filter((r) => r.dCount !== 0 || r.dSize !== 0)
    .sort((x, y) => y.dCount - x.dCount)
    .slice(0, 60)
    .forEach((d) => {
      console.log(
        `  ${d.aCount.toString().padStart(6)} → ${d.bCount.toString().padStart(6)} ` +
          `(+${d.dCount.toString().padStart(5)}, ` +
          `+${(d.dSize / 1048576).toFixed(2)}MB) ` +
          d.key,
      );
    });
}
main();
