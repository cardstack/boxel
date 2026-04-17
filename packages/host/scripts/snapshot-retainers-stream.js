#!/usr/bin/env node
/**
 * Streaming version of snapshot-retainers.js for heap snapshots >500MB.
 * Pulls `snapshot.meta`, `nodes`, `edges`, `strings` out via stream-json,
 * then runs the same BFS retainer analysis as the non-streaming script.
 *
 * Usage: node --max-old-space-size=16384 scripts/snapshot-retainers-stream.js
 *          <snap.heapsnapshot> <name-pattern> [--max=N] [--depth=D]
 *          [--min-size=N] [--type=<native|object|closure|string>] [--strong]
 */
const fs = require('fs');
const SJ =
  '/Users/lmelia/p/cardstack/boxel/node_modules/.pnpm/stream-json@1.9.1/node_modules/stream-json';
const { parser } = require(SJ + '/Parser.js');
const Asm = require(SJ + '/Assembler.js');

// Growable Float64Array wrapper. Regular JS arrays work for small snapshots
// but push throws "Invalid array length" when the array's backing store is
// grown into a non-packed mode around ~100M elements. Typed arrays don't
// suffer from that because they're flat.
class F64List {
  constructor(initial = 1 << 20) {
    this.buf = new Float64Array(initial);
    this.length = 0;
  }
  push(v) {
    if (this.length === this.buf.length) {
      let next = new Float64Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = v;
  }
  toTyped() {
    return this.buf.subarray(0, this.length);
  }
}

function loadStream(snapPath) {
  process.stderr.write(
    `streaming ${snapPath} (${(fs.statSync(snapPath).size / 1048576).toFixed(1)}MB)...\n`,
  );
  return new Promise((resolve, reject) => {
    let meta = null;
    let nodes = new F64List();
    let edges = new F64List();
    let strings = [];
    let depth = 0;
    let collecting = null;
    let asm = null;
    let finished = false;

    const p = parser({ packKeys: true, packStrings: true, packNumbers: true });
    const stream = fs.createReadStream(snapPath);
    stream.on('error', reject);
    stream.pipe(p);

    const feedAsm = (name, value) => {
      if (!asm || typeof asm[name] !== 'function') return;
      asm[name](value);
    };

    p.on('data', (chunk) => {
      const n = chunk.name;
      if (n === 'keyValue') {
        if (depth === 1) {
          const k = chunk.value;
          if (k === 'snapshot') {
            collecting = 'snapshot';
            asm = new Asm();
          } else if (k === 'nodes') {
            collecting = 'nodes';
            asm = null;
          } else if (k === 'edges') {
            collecting = 'edges';
            asm = null;
          } else if (k === 'strings') {
            collecting = 'strings';
            asm = null;
          } else {
            collecting = null;
            asm = null;
          }
        } else if (collecting === 'snapshot') {
          feedAsm('keyValue', chunk.value);
        }
        return;
      }
      if (n === 'startObject') {
        if (collecting === 'snapshot') feedAsm('startObject');
        depth++;
        return;
      }
      if (n === 'startArray') {
        if (collecting === 'snapshot') feedAsm('startArray');
        depth++;
        return;
      }
      if (n === 'endObject' || n === 'endArray') {
        depth--;
        if (collecting === 'snapshot') {
          feedAsm(n);
          if (depth === 1) {
            meta = asm.current && asm.current.meta;
            collecting = null;
            asm = null;
          }
        } else if (
          (collecting === 'nodes' ||
            collecting === 'edges' ||
            collecting === 'strings') &&
          depth === 1
        ) {
          collecting = null;
        }
        if (
          !finished &&
          meta &&
          nodes.length > 0 &&
          edges.length > 0 &&
          strings.length > 0 &&
          depth <= 1 &&
          collecting === null
        ) {
          p.removeAllListeners('data');
          stream.destroy();
          finish();
        }
        return;
      }
      if (collecting === 'snapshot') {
        feedAsm(n, chunk.value);
      } else if (collecting === 'nodes' && n === 'numberValue') {
        nodes.push(+chunk.value);
      } else if (collecting === 'edges' && n === 'numberValue') {
        edges.push(+chunk.value);
      } else if (collecting === 'strings' && n === 'stringValue') {
        strings.push(chunk.value);
      }
    });

    p.on('end', finish);
    p.on('error', reject);

    function finish() {
      if (finished) return;
      finished = true;
      if (!meta || !nodes.length || !edges.length || !strings.length) {
        reject(
          new Error(
            `incomplete: meta=${!!meta} nodes=${nodes.length} edges=${edges.length} strings=${strings.length}`,
          ),
        );
        return;
      }
      let nodesTyped = nodes.toTyped();
      let edgesTyped = edges.toTyped();
      process.stderr.write(
        `  ${(nodesTyped.length / meta.node_fields.length).toLocaleString()} nodes, ${(edgesTyped.length / meta.edge_fields.length).toLocaleString()} edges, ${strings.length.toLocaleString()} strings\n`,
      );
      resolve(buildHeap(meta, nodesTyped, edgesTyped, strings));
    }
  });
}

function buildHeap(meta, nodes, edges, strings) {
  let nodeFieldsList = meta.node_fields;
  let edgeFieldsList = meta.edge_fields;
  let nodeTypes = meta.node_types[nodeFieldsList.indexOf('type')];
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
  let eToIdx = edgeFieldsList.indexOf('to_node');

  let nodeCount = nodes.length / NF;
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
  let revCount = new Uint32Array(h.nodeCount);
  for (let eo = 0; eo < h.edges.length; eo += h.EF) {
    let toNode = h.edges[eo + h.eToIdx] / h.NF;
    revCount[toNode]++;
  }
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
  let revFrom = new Uint32Array(totalRev);
  let revEdge = new Uint32Array(totalRev);
  let cursor = new Uint32Array(h.nodeCount);
  for (let nodeIdx = 0; nodeIdx < h.nodeCount; nodeIdx++) {
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
    if (re.test(name)) targets.push(n);
  }
  return targets;
}

function shortestPathToRoot(h, rev, target, maxDepth, strongOnly) {
  let visited = new Set();
  let queue = [{ node: target, path: [] }];
  let head = 0;
  visited.add(target);
  while (head < queue.length) {
    let { node, path } = queue[head++];
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
      if (strongOnly && eType === 'internal') {
        let nameStr = h.strings[h.edges[edgeOffset + h.eNameIdx]] || '';
        if (nameStr.indexOf('part of key') !== -1) continue;
      }
      visited.add(from);
      queue.push({
        node: from,
        path: path.concat([{ node, edgeDesc: edgeDescription(h, edgeOffset) }]),
      });
    }
  }
  return null;
}

function formatPath(h, path) {
  let parts = [];
  for (let i = path.length - 1; i >= 0; i--) {
    parts.push(nodeLabel(h, path[i].node));
    if (i > 0 && path[i - 1].edgeDesc) {
      parts.push(`  --[${path[i - 1].edgeDesc}]-->`);
    }
  }
  return parts.join('\n');
}

async function main() {
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
      'usage: snapshot-retainers-stream <snap.heapsnapshot> <name-pattern> [--max=N] [--depth=D] [--type=T] [--strong]',
    );
    process.exit(2);
  }
  let h = await loadStream(snapPath);
  process.stderr.write(`finding targets matching /${pattern}/...\n`);
  let targets = findTargets(h, pattern, opts);
  process.stderr.write(`  found ${targets.length} targets\n`);
  let rev = buildReverseIndex(h);

  let sigGroups = new Map();
  let sampled = targets.slice(0, maxTargets);
  for (let t of sampled) {
    let path = shortestPathToRoot(h, rev, t, maxDepth, opts.strongOnly);
    if (!path) {
      console.log(`${nodeLabel(h, t)}: NO PATH WITHIN DEPTH ${maxDepth}`);
      continue;
    }
    let sig = path
      .slice(0, -1)
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
