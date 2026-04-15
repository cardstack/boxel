#!/usr/bin/env node
/**
 * Diff two Chrome heap snapshots, reporting constructor-name counts that grew.
 * Usage: node scripts/snapshot-diff.js snap-a.heapsnapshot snap-b.heapsnapshot
 * Node flag: --max-old-space-size=16384 recommended.
 */
const fs = require('fs');

function load(path) {
  console.log(`loading ${path} (${fs.statSync(path).size} bytes)...`);
  let snap = JSON.parse(fs.readFileSync(path, 'utf8'));
  let meta = snap.snapshot.meta;
  let nodeFields = meta.node_fields;
  let nodeTypes = meta.node_types[nodeFields.indexOf('type')];
  let nodeFieldCount = nodeFields.length;
  let nameIdx = nodeFields.indexOf('name');
  let typeIdx = nodeFields.indexOf('type');
  let sizeIdx = nodeFields.indexOf('self_size');
  let nodes = snap.nodes;
  let strings = snap.strings;
  let counts = new Map(); // constructor -> {count, size}
  for (let i = 0; i < nodes.length; i += nodeFieldCount) {
    let type = nodeTypes[nodes[i + typeIdx]];
    let name = strings[nodes[i + nameIdx]];
    let key = `${type}::${name}`;
    let c = counts.get(key);
    if (!c) {
      c = { count: 0, size: 0 };
      counts.set(key, c);
    }
    c.count++;
    c.size += nodes[i + sizeIdx];
  }
  console.log(
    `  ${(nodes.length / nodeFieldCount).toLocaleString()} nodes, ${counts.size.toLocaleString()} distinct constructors`,
  );
  return counts;
}

function main() {
  let [a, b] = process.argv.slice(2);
  if (!a || !b) {
    console.error('usage: snapshot-diff <a.heapsnapshot> <b.heapsnapshot>');
    process.exit(2);
  }
  let ca = load(a);
  let cb = load(b);
  let all = new Set([...ca.keys(), ...cb.keys()]);
  let deltas = [];
  for (let key of all) {
    let av = ca.get(key) || { count: 0, size: 0 };
    let bv = cb.get(key) || { count: 0, size: 0 };
    deltas.push({
      key,
      dCount: bv.count - av.count,
      dSize: bv.size - av.size,
      aCount: av.count,
      bCount: bv.count,
      aSize: av.size,
      bSize: bv.size,
    });
  }

  console.log('\n=== top 40 by retained-size delta ===');
  deltas
    .sort((x, y) => y.dSize - x.dSize)
    .slice(0, 40)
    .forEach((d) => {
      console.log(
        `  +${(d.dSize / 1048576).toFixed(1)}MB ` +
          `count ${d.aCount}→${d.bCount} (+${d.dCount}) ` +
          d.key,
      );
    });

  console.log('\n=== top 20 by count delta ===');
  deltas
    .sort((x, y) => y.dCount - x.dCount)
    .slice(0, 20)
    .forEach((d) => {
      console.log(
        `  +${d.dCount} count ${d.aCount}→${d.bCount} ` +
          `(+${(d.dSize / 1048576).toFixed(1)}MB) ` +
          d.key,
      );
    });
}
main();
