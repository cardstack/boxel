#!/usr/bin/env node
/**
 * Find retainer paths from GC roots to nodes matching a pattern.
 * Usage: node --max-old-space-size=16384 scripts/snapshot-retainers.js <snap.heapsnapshot> <name-pattern> [--max=N] [--depth=D]
 *
 * Strategy:
 *   1. Parse heapsnapshot JSON
 *   2. Build reverse-edge index (to_node -> [{from_node, edge_name}])
 *   3. Find target nodes whose constructor name matches pattern
 *   4. BFS backwards from each target up to --depth edges
 *   5. Report the most common retainer paths (suffix-grouped)
 *
 * Node types: hidden, array, string, object, code, closure, regexp, number,
 *             native, synthetic, concatenated string, sliced string, symbol, bigint
 * Edge types: context, element, property, internal, hidden, shortcut, weak
 */
const fs = require('fs');

function load(path) {
  process.stderr.write(
    `loading ${path} (${(fs.statSync(path).size / 1048576).toFixed(1)}MB)...\n`,
  );
  let snap = JSON.parse(fs.readFileSync(path, 'utf8'));
  let meta = snap.snapshot.meta;
  let nodeFieldsList = meta.node_fields;
  let nodeTypes = meta.node_types[nodeFieldsList.indexOf('type')];
  let edgeFieldsList = meta.edge_fields;
  let edgeTypes = meta.edge_types[edgeFieldsList.indexOf('type')];
  let NF = nodeFieldsList.length;
  let EF = edgeFieldsList.length;
  let nameIdx = nodeFieldsList.indexOf('name');
  let typeIdx = nodeFieldsList.indexOf('type');
  let sizeIdx = nodeFieldsList.indexOf('self_size');
  let idIdx = nodeFieldsList.indexOf('id');
  let edgeCountIdx = nodeFieldsList.indexOf('edge_count');
  let eTypeIdx = edgeFieldsList.indexOf('type');
  let eNameIdx = edgeFieldsList.indexOf('name_or_index');
  let eToIdx = edgeFieldsList.indexOf('to_node'); // offset into nodes array (node_index * NF)
  let nodes = snap.nodes;
  let edges = snap.edges;
  let strings = snap.strings;

  let nodeCount = nodes.length / NF;
  // edgeOffset[i] = offset into edges[] where node i's edges start
  let edgeOffsets = new Uint32Array(nodeCount + 1);
  {
    let off = 0;
    for (let i = 0; i < nodeCount; i++) {
      edgeOffsets[i] = off;
      off += nodes[i * NF + edgeCountIdx] * EF;
    }
    edgeOffsets[nodeCount] = off;
  }

  return {
    snap,
    nodes,
    edges,
    strings,
    NF,
    EF,
    nameIdx,
    typeIdx,
    sizeIdx,
    idIdx,
    edgeCountIdx,
    eTypeIdx,
    eNameIdx,
    eToIdx,
    nodeTypes,
    edgeTypes,
    nodeCount,
    edgeOffsets,
  };
}

function nodeLabel(h, nodeIdx) {
  let i = nodeIdx * h.NF;
  let type = h.nodeTypes[h.nodes[i + h.typeIdx]];
  let name = h.strings[h.nodes[i + h.nameIdx]];
  let id = h.nodes[i + h.idIdx];
  let shortName =
    name && name.length > 80 ? name.slice(0, 60) + '…' : name || '';
  return `${type}::${shortName}#${id}`;
}

function buildReverseIndex(h) {
  process.stderr.write('building reverse edge index...\n');
  // First pass: count reverse edges per node
  let revCount = new Uint32Array(h.nodeCount);
  for (let eo = 0; eo < h.edges.length; eo += h.EF) {
    let toOffset = h.edges[eo + h.eToIdx]; // offset into nodes[], divide by NF for node idx
    let toNode = toOffset / h.NF;
    revCount[toNode]++;
  }
  // Allocate flat arrays
  let totalRev = 0;
  for (let i = 0; i < h.nodeCount; i++) totalRev += revCount[i];
  process.stderr.write(`  total reverse edges: ${totalRev.toLocaleString()}\n`);
  let revOffsets = new Uint32Array(h.nodeCount + 1);
  {
    let off = 0;
    for (let i = 0; i < h.nodeCount; i++) {
      revOffsets[i] = off;
      off += revCount[i];
    }
    revOffsets[h.nodeCount] = off;
  }
  // revFrom[k] = source node index, revEdge[k] = edge offset
  let revFrom = new Uint32Array(totalRev);
  let revEdge = new Uint32Array(totalRev);
  let cursor = new Uint32Array(h.nodeCount);
  // Walk forward edges, assigning each to its destination's slot
  let nodeIdx = 0;
  for (nodeIdx = 0; nodeIdx < h.nodeCount; nodeIdx++) {
    let eStart = h.edgeOffsets[nodeIdx];
    let eEnd = h.edgeOffsets[nodeIdx + 1];
    for (let eo = eStart; eo < eEnd; eo += h.EF) {
      let toNode = h.edges[eo + h.eToIdx] / h.NF;
      let slot = revOffsets[toNode] + cursor[toNode]++;
      revFrom[slot] = nodeIdx;
      revEdge[slot] = eo;
    }
  }
  return { revOffsets, revFrom, revEdge };
}

function edgeDescription(h, edgeOffset) {
  let eType = h.edgeTypes[h.edges[edgeOffset + h.eTypeIdx]];
  let nameOrIdx = h.edges[edgeOffset + h.eNameIdx];
  let nameStr;
  if (eType === 'element' || eType === 'hidden') {
    nameStr = `[${nameOrIdx}]`;
  } else {
    nameStr = h.strings[nameOrIdx] || '';
    if (nameStr.length > 40) nameStr = nameStr.slice(0, 30) + '…';
  }
  return `${eType}:${nameStr}`;
}

function findTargets(h, pattern, opts) {
  let re = new RegExp(pattern);
  let minSize = opts && opts.minSize ? opts.minSize : 0;
  let typeFilter = opts && opts.type;
  let targets = [];
  for (let n = 0; n < h.nodeCount; n++) {
    let i = n * h.NF;
    let type = h.nodeTypes[h.nodes[i + h.typeIdx]];
    if (typeFilter) {
      if (type !== typeFilter) continue;
    } else if (type !== 'object' && type !== 'closure') {
      continue;
    }
    let selfSize = h.nodes[i + h.sizeIdx];
    if (selfSize < minSize) continue;
    let name = h.strings[h.nodes[i + h.nameIdx]] || '';
    if (re.test(name)) {
      targets.push(n);
    }
  }
  return targets;
}

// BFS backwards from target, up to maxDepth. Returns array of paths (each an array of {node, edgeDesc}).
// If strongOnly is true, ignore 'weak' and 'shortcut' edges (these don't actually retain).
function shortestPathToRoot(h, rev, target, maxDepth, strongOnly) {
  let visited = new Set();
  let queue = [{ node: target, path: [] }];
  visited.add(target);
  while (queue.length) {
    let { node, path } = queue.shift();
    if (path.length > maxDepth) return null;
    let nodeType = h.nodeTypes[h.nodes[node * h.NF + h.typeIdx]];
    if (node === 0 || (nodeType === 'synthetic' && path.length > 0)) {
      return path.concat([{ node, edgeDesc: null }]);
    }
    let rStart = rev.revOffsets[node];
    let rEnd = rev.revOffsets[node + 1];
    for (let k = rStart; k < rEnd; k++) {
      let from = rev.revFrom[k];
      if (visited.has(from)) continue;
      let edgeOffset = rev.revEdge[k];
      let eType = h.edgeTypes[h.edges[edgeOffset + h.eTypeIdx]];
      if (strongOnly && (eType === 'weak' || eType === 'shortcut')) continue;
      // WeakMap "internal:N / part of key (X)" edges represent weak-key
      // retention. If strongOnly, skip entries of WeakMaps (the `from` node
      // is a WeakMap's hashtable array; the edge name contains "part of key").
      if (strongOnly && eType === 'internal') {
        let nameStr = h.strings[h.edges[edgeOffset + h.eNameIdx]] || '';
        if (nameStr.indexOf('part of key') !== -1) continue;
      }
      visited.add(from);
      let edgeDesc = edgeDescription(h, edgeOffset);
      queue.push({
        node: from,
        path: path.concat([{ node, edgeDesc }]),
      });
    }
  }
  return null;
}

function formatPath(h, path) {
  // path is [{node, edgeDesc}, ...] where path[0] is target, path[last] is root
  let parts = [];
  for (let i = path.length - 1; i >= 0; i--) {
    parts.push(nodeLabel(h, path[i].node));
    if (i > 0 && path[i - 1].edgeDesc) {
      parts.push(`  --[${path[i - 1].edgeDesc}]-->`);
    }
  }
  return parts.join('\n');
}

function main() {
  let args = process.argv.slice(2);
  let snapPath = args[0];
  let pattern = args[1];
  let maxTargets = 10;
  let maxDepth = 25;
  let opts = {};
  for (let a of args.slice(2)) {
    let m = a.match(/^--max=(\d+)$/);
    if (m) maxTargets = parseInt(m[1]);
    m = a.match(/^--depth=(\d+)$/);
    if (m) maxDepth = parseInt(m[1]);
    m = a.match(/^--min-size=(\d+)$/);
    if (m) opts.minSize = parseInt(m[1]);
    m = a.match(/^--type=(\w+)$/);
    if (m) opts.type = m[1];
    if (a === '--strong') opts.strongOnly = true;
  }
  if (!snapPath || !pattern) {
    console.error(
      'usage: snapshot-retainers <snap.heapsnapshot> <name-pattern> [--max=N] [--depth=D]',
    );
    process.exit(2);
  }
  let h = load(snapPath);
  process.stderr.write(`finding targets matching /${pattern}/...\n`);
  let targets = findTargets(h, pattern, opts);
  process.stderr.write(`  found ${targets.length} targets\n`);
  let rev = buildReverseIndex(h);

  // Group paths by their "signature" (edge descriptions joined)
  let sigGroups = new Map();
  let sampled = targets.slice(0, maxTargets);
  for (let t of sampled) {
    let path = shortestPathToRoot(h, rev, t, maxDepth, opts.strongOnly);
    if (!path) {
      console.log(`${nodeLabel(h, t)}: NO PATH WITHIN DEPTH ${maxDepth}`);
      continue;
    }
    let sig = path
      .slice(0, -1) // skip root
      .map((p) => p.edgeDesc)
      .filter(Boolean)
      .join(' | ');
    if (!sigGroups.has(sig)) sigGroups.set(sig, []);
    sigGroups.get(sig).push({ target: t, path });
  }
  let sorted = [...sigGroups.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  for (let [sig, group] of sorted) {
    console.log('\n' + '='.repeat(80));
    console.log(`RETAINER SIGNATURE (${group.length} targets):`);
    console.log(sig);
    console.log('\nExample path:');
    console.log(formatPath(h, group[0].path));
  }
}

main();
