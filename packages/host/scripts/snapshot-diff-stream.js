#!/usr/bin/env node
/**
 * Streaming version of snapshot-diff.js for heap snapshots >500MB where V8's
 * max string length (~0x1fffffe8 bytes) blocks fs.readFileSync('utf8').
 *
 * Uses stream-json to pull only `snapshot.meta` (assembled), `nodes` (flat
 * number array), and `strings` (flat string array) out of the heap snapshot
 * file, then builds constructor counts identically to the non-streaming diff.
 *
 * Usage: node --max-old-space-size=16384 scripts/snapshot-diff-stream.js a b
 */
const fs = require('fs');
const SJ =
  '/Users/lmelia/p/cardstack/boxel/node_modules/.pnpm/stream-json@1.9.1/node_modules/stream-json';
const { parser } = require(SJ + '/Parser.js');
const Asm = require(SJ + '/Assembler.js');

async function load(snapPath) {
  console.log(`streaming ${snapPath} (${fs.statSync(snapPath).size} bytes)...`);
  return new Promise((resolve, reject) => {
    let meta = null;
    let nodes = [];
    let strings = [];

    let depth = 0;
    let collecting = null; // 'snapshot' | 'nodes' | 'strings' | null
    let asm = null; // only used while collecting 'snapshot'
    let finished = false;

    const p = parser({ packKeys: true, packStrings: true, packNumbers: true });
    const stream = fs.createReadStream(snapPath);
    stream.on('error', reject);
    stream.pipe(p);

    const feedAsm = (name, value) => {
      if (!asm) return;
      if (typeof asm[name] === 'function') asm[name](value);
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
          feedAsm(n === 'endObject' ? 'endObject' : 'endArray');
          if (depth === 1) {
            meta = asm.current && asm.current.meta;
            collecting = null;
            asm = null;
          }
        } else if ((collecting === 'nodes' || collecting === 'strings') && depth === 1) {
          collecting = null;
        }
        if (!finished && meta && nodes.length && strings.length && depth <= 1 && collecting === null) {
          p.removeAllListeners('data');
          stream.destroy();
          finish();
        }
        return;
      }

      // Primitive events
      if (collecting === 'snapshot') {
        feedAsm(n, chunk.value);
      } else if (collecting === 'nodes' && n === 'numberValue') {
        nodes.push(+chunk.value);
      } else if (collecting === 'strings' && n === 'stringValue') {
        strings.push(chunk.value);
      }
    });

    p.on('end', finish);
    p.on('error', reject);

    function finish() {
      if (finished) return;
      finished = true;
      if (!meta || !nodes.length || !strings.length) {
        reject(new Error(`did not find all sections: meta=${!!meta}, nodes=${nodes.length}, strings=${strings.length}`));
        return;
      }
      let nodeFields = meta.node_fields;
      let nodeTypes = meta.node_types[nodeFields.indexOf('type')];
      let nodeFieldCount = nodeFields.length;
      let nameIdx = nodeFields.indexOf('name');
      let typeIdx = nodeFields.indexOf('type');
      let sizeIdx = nodeFields.indexOf('self_size');
      let counts = new Map();
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
      resolve(counts);
    }
  });
}

(async () => {
  let [a, b] = process.argv.slice(2);
  if (!a || !b) {
    console.error('usage: snapshot-diff-stream <a.heapsnapshot> <b.heapsnapshot>');
    process.exit(2);
  }
  let ca = await load(a);
  let cb = await load(b);
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
    });
  }
  console.log('\n=== top 40 by retained-size delta ===');
  deltas
    .sort((x, y) => y.dSize - x.dSize)
    .slice(0, 40)
    .forEach((d) => {
      console.log(
        `  +${(d.dSize / 1048576).toFixed(1)}MB count ${d.aCount}→${d.bCount} (+${d.dCount}) ` + d.key,
      );
    });
  console.log('\n=== top 20 by count delta ===');
  deltas
    .sort((x, y) => y.dCount - x.dCount)
    .slice(0, 20)
    .forEach((d) => {
      console.log(
        `  +${d.dCount} count ${d.aCount}→${d.bCount} (+${(d.dSize / 1048576).toFixed(1)}MB) ` + d.key,
      );
    });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
