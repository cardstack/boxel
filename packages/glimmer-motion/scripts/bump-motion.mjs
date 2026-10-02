// Moves the workspace catalog's Motion pins (framer-motion, motion, motion-dom,
// motion-utils) to a newer framer-motion release, and writes the report a bump
// PR carries: how the TypeScript source of every framer-motion module
// glimmer-motion inlines, adapts or ports differs between the two releases.
// The adapted and ported modules come from VENDORED.md's tables.
//
//   node scripts/bump-motion.mjs                 print the release a bump would take
//   node scripts/bump-motion.mjs --write         move the pins to it
//   node scripts/bump-motion.mjs --to 13.5.0 --write --report body.md
//
// `--to` names the framer-motion release instead of picking one. `--report`
// writes the PR body (`-` for stdout). Run `pnpm install` after `--write` to
// update the lockfile. Under GitHub Actions the chosen versions are also
// written to $GITHUB_OUTPUT (`version` is empty when there is nothing to bump).
//
// The release picked is the newest stable framer-motion above the pin that
// pnpm's `minimumReleaseAge` lets it install, with a `motion` release of the
// same version. motion-dom and motion-utils move to the lower bounds of the
// ranges that framer-motion release declares: the versions it was released
// against.
/* eslint-disable n/no-unsupported-features/node-builtins -- a repo script that runs on the mise-pinned Node, not part of the published addon */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { parseArgs } from 'node:util';

const packageDir = new URL('..', import.meta.url).pathname;
const repoRoot = join(packageDir, '..', '..');
const workspaceFile = join(repoRoot, 'pnpm-workspace.yaml');
const packageJsonFile = join(packageDir, 'package.json');
const internalsFile = join(packageDir, 'src', 'framer-motion-internals.ts');
const vendoredFile = join(packageDir, 'VENDORED.md');
const registry = 'https://registry.npmjs.org';

// A `here | upstream` table in VENDORED.md, under `## <heading>`: each
// glimmer-motion file mapped to the framer-motion dist/es modules built from
// the upstream sources the table names (paths relative to framer-motion's
// src/).
function vendoredTable(heading) {
  const md = readFileSync(vendoredFile, 'utf8');
  const start = md.indexOf(`\n## ${heading}\n`);
  if (start === -1) {
    throw new Error(`VENDORED.md has no "## ${heading}" section`);
  }
  const table = {};
  for (const line of md
    .slice(start + 1)
    .split(/\n## /)[0]
    .split('\n')) {
    const cells = line.split('|').slice(1, -1);
    const here = cells[0]?.trim().match(/^`(src\/[^`]+)`$/);
    if (cells.length !== 2 || !here) {
      continue;
    }
    const upstream = [...cells[1].matchAll(/`([^`]+)\.tsx?`/g)].map(
      (m) => `${m[1]}.mjs`,
    );
    if (!upstream.length) {
      throw new Error(
        `VENDORED.md's "${heading}" row for ${here[1]} names no upstream .ts/.tsx file`,
      );
    }
    table[here[1]] = upstream;
  }
  if (!Object.keys(table).length) {
    throw new Error(`VENDORED.md's "${heading}" section has no table rows`);
  }
  return table;
}

// Each upstream module in `mapping`, with the glimmer-motion files built from it.
const byUpstream = (mapping) => {
  const owners = new Map();
  for (const [file, modules] of Object.entries(mapping)) {
    for (const module of modules) {
      owners.set(module, [...(owners.get(module) ?? []), file]);
    }
  }
  return owners;
};

// GitHub rejects a PR body over 65,536 characters. A report printed to stdout
// (`--report -`) has no budget and carries every diff.
const prBodyBudget = 60_000;

const { values: args } = parseArgs({
  options: {
    to: { type: 'string' },
    write: { type: 'boolean', default: false },
    report: { type: 'string' },
  },
});

const stable = /^\d+\.\d+\.\d+$/;
const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

function readPins() {
  const yaml = readFileSync(workspaceFile, 'utf8');
  const pin = (name) => {
    const matches = [
      ...yaml.matchAll(new RegExp(`^  ${name}: (\\d+\\.\\d+\\.\\d+)$`, 'gm')),
    ];
    if (matches.length !== 1) {
      throw new Error(
        `expected one exact catalog pin for ${name} in pnpm-workspace.yaml, found ${matches.length}`,
      );
    }
    return matches[0][1];
  };
  const age = yaml.match(/^minimumReleaseAge: (\d+)$/m);
  return {
    pins: {
      'framer-motion': pin('framer-motion'),
      motion: pin('motion'),
      'motion-dom': pin('motion-dom'),
      'motion-utils': pin('motion-utils'),
    },
    minimumReleaseAgeMinutes: age ? Number(age[1]) : 0,
  };
}

async function packument(name) {
  const response = await fetch(`${registry}/${name}`);
  if (!response.ok) {
    throw new Error(`${registry}/${name}: ${response.status}`);
  }
  return response.json();
}

// The lower bound of a `^x.y.z` range that `dependent` declares on `name`.
function floorOf(range, name, dependent) {
  const m = range?.match(/^\^(\d+\.\d+\.\d+)$/);
  if (!m) {
    throw new Error(
      `${dependent} declares ${name} ${range ?? '(nothing)'}; expected a ^x.y.z range`,
    );
  }
  return m[1];
}

async function pickRelease(current, minimumReleaseAgeMinutes) {
  const [framerMotion, motion, motionDom, motionUtils] = await Promise.all(
    ['framer-motion', 'motion', 'motion-dom', 'motion-utils'].map(packument),
  );
  const cutoff = Date.now() - minimumReleaseAgeMinutes * 60_000;
  const oldEnough = (doc, v) =>
    doc.versions[v] &&
    !doc.versions[v].deprecated &&
    Date.parse(doc.time[v]) <= cutoff;
  const describe = (version) => {
    const { dependencies = {} } = framerMotion.versions[version];
    const dependent = `framer-motion@${version}`;
    const release = {
      'framer-motion': version,
      motion: version,
      'motion-dom': floorOf(
        dependencies['motion-dom'],
        'motion-dom',
        dependent,
      ),
      'motion-utils': floorOf(
        dependencies['motion-utils'],
        'motion-utils',
        dependent,
      ),
    };
    // The root overrides give motion-dom the catalog's motion-utils, whatever
    // motion-dom declares, so the two picks have to agree.
    const dom = motionDom.versions[release['motion-dom']];
    if (!dom) {
      throw new Error(`motion-dom@${release['motion-dom']} is not on npm`);
    }
    const domNeeds = dom.dependencies?.['motion-utils'];
    if (
      domNeeds &&
      compare(
        floorOf(
          domNeeds,
          'motion-utils',
          `motion-dom@${release['motion-dom']}`,
        ),
        release['motion-utils'],
      ) > 0
    ) {
      throw new Error(
        `motion-dom@${release['motion-dom']} declares motion-utils ${domNeeds}, newer than the motion-utils@${release['motion-utils']} ${dependent} declares`,
      );
    }
    return release;
  };

  if (args.to) {
    if (!framerMotion.versions[args.to]) {
      throw new Error(`framer-motion@${args.to} is not on npm`);
    }
    if (!motion.versions[args.to]) {
      throw new Error(`motion@${args.to} is not on npm`);
    }
    const release = describe(args.to);
    if (
      !oldEnough(framerMotion, args.to) ||
      !oldEnough(motion, args.to) ||
      !oldEnough(motionDom, release['motion-dom']) ||
      !oldEnough(motionUtils, release['motion-utils'])
    ) {
      console.warn(
        `warning: part of this release is younger than minimumReleaseAge (${minimumReleaseAgeMinutes} min); pnpm install will refuse it`,
      );
    }
    return { release, tarballs: tarballsFor(framerMotion, current, args.to) };
  }

  const latest = framerMotion['dist-tags'].latest;
  const candidates = Object.keys(framerMotion.versions)
    .filter(
      (v) =>
        stable.test(v) && compare(v, current) > 0 && compare(v, latest) <= 0,
    )
    .sort(compare)
    .reverse();
  for (const version of candidates) {
    if (!oldEnough(framerMotion, version) || !oldEnough(motion, version)) {
      continue;
    }
    const release = describe(version);
    if (
      oldEnough(motionDom, release['motion-dom']) &&
      oldEnough(motionUtils, release['motion-utils'])
    ) {
      return {
        release,
        tarballs: tarballsFor(framerMotion, current, version),
      };
    }
  }
  if (candidates.length) {
    console.log(
      `framer-motion ${candidates.join(', ')} ${candidates.length === 1 ? 'is' : 'are'} newer than ${current} but younger than minimumReleaseAge (${minimumReleaseAgeMinutes} min)`,
    );
  }
  return null;
}

function tarballsFor(framerMotion, from, to) {
  return {
    from: framerMotion.versions[from].dist.tarball,
    to: framerMotion.versions[to].dist.tarball,
  };
}

function writePins(release) {
  let yaml = readFileSync(workspaceFile, 'utf8');
  for (const [name, version] of Object.entries(release)) {
    yaml = yaml.replace(
      new RegExp(`^(  ${name}: )\\d+\\.\\d+\\.\\d+$`, 'm'),
      `$1${version}`,
    );
  }
  writeFileSync(workspaceFile, yaml);

  // A peer range keeps its operator (`^`, `~` or none) and moves its version.
  const pkg = JSON.parse(readFileSync(packageJsonFile, 'utf8'));
  for (const name of ['motion-dom', 'motion-utils']) {
    const m = pkg.peerDependencies[name]?.match(/^([~^]?)\d+\.\d+\.\d+$/);
    if (!m) {
      throw new Error(
        `glimmer-motion's ${name} peer range is ${pkg.peerDependencies[name] ?? '(missing)'}; expected ^x.y.z, ~x.y.z or x.y.z`,
      );
    }
    pkg.peerDependencies[name] = `${m[1]}${release[name]}`;
  }
  writeFileSync(packageJsonFile, JSON.stringify(pkg, null, 2) + '\n');
}

async function unpack(url, dir) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  const tarball = join(dir, 'package.tgz');
  writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  const tar = spawnSync('tar', ['-xzf', tarball, '-C', dir]);
  if (tar.status !== 0) {
    throw new Error(`tar -xzf ${url}: ${tar.stderr}`);
  }
  return join(dir, 'package', 'dist', 'es');
}

// Each module reachable from `entries` through relative imports, as a path
// relative to dist/es.
function closure(distEs, entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path) || !existsSync(join(distEs, path))) {
      continue;
    }
    seen.add(path);
    const code = readFileSync(join(distEs, path), 'utf8');
    for (const [, spec] of code.matchAll(
      /(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    )) {
      queue.push(posix.normalize(posix.join(posix.dirname(path), spec)));
    }
  }
  return seen;
}

// The TypeScript a dist/es module was built from, and its path in upstream's
// repo, read from the module's source map.
function sourceOf(distEs, path) {
  const file = join(distEs, path);
  if (!existsSync(file)) {
    return null;
  }
  const mapFile = `${file}.map`;
  if (existsSync(mapFile)) {
    const map = JSON.parse(readFileSync(mapFile, 'utf8'));
    if (map.sources?.length === 1 && map.sourcesContent?.[0] != null) {
      return {
        path: posix.normalize(
          posix.join(
            'packages/framer-motion/dist/es',
            posix.dirname(path),
            map.sources[0],
          ),
        ),
        text: map.sourcesContent[0],
      };
    }
  }
  return {
    path: `packages/framer-motion/dist/es/${path}`,
    text: readFileSync(file, 'utf8'),
  };
}

function unifiedDiff(scratch, path, before, after) {
  const root = mkdtempSync(join(scratch, 'diff-'));
  for (const [side, source] of [
    ['a', before],
    ['b', after],
  ]) {
    const file = join(root, side, path);
    mkdirSync(dirname(file), { recursive: true });
    if (source != null) {
      writeFileSync(file, source);
    }
  }
  const diff = spawnSync(
    'git',
    [
      'diff',
      '--no-index',
      '--no-color',
      '--no-prefix',
      '--',
      before == null ? '/dev/null' : join('a', path),
      after == null ? '/dev/null' : join('b', path),
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (diff.status !== 0 && diff.status !== 1) {
    throw new Error(`git diff --no-index ${path}: ${diff.stderr}`);
  }
  return diff.stdout;
}

async function compareSources(from, to, tarballs) {
  const scratch = mkdtempSync(join(tmpdir(), 'bump-motion-'));
  try {
    const [before, after] = await Promise.all([
      unpack(tarballs.from, mkdtempSync(join(scratch, `${from}-`))),
      unpack(tarballs.to, mkdtempSync(join(scratch, `${to}-`))),
    ]);
    const entries = [
      ...readFileSync(internalsFile, 'utf8').matchAll(
        /'framer-motion\/dist\/es\/([^']+\.mjs)'/g,
      ),
    ].map((m) => m[1]);
    const imported = new Set([
      ...closure(before, entries),
      ...closure(after, entries),
    ]);
    const adapted = byUpstream(vendoredTable('Adapted, not inlined'));
    const ported = byUpstream(vendoredTable('Ported by hand'));
    for (const path of [...entries, ...adapted.keys(), ...ported.keys()]) {
      imported.delete(path);
    }

    const changes = (paths, owners) =>
      [...paths].sort().flatMap((path) => {
        const a = sourceOf(before, path);
        const b = sourceOf(after, path);
        if (!a && !b) {
          // A renamed or moved upstream module would otherwise report as
          // unchanged.
          throw new Error(
            `framer-motion ${from} and ${to} both lack dist/es/${path}; update its row in VENDORED.md`,
          );
        }
        if (a?.text === b?.text) {
          return [];
        }
        const sourcePath = (b ?? a).path;
        return [
          {
            path: sourcePath,
            status: !a ? 'added' : !b ? 'removed' : 'changed',
            owners: owners?.get(path) ?? [],
            diff: unifiedDiff(scratch, sourcePath, a?.text, b?.text),
          },
        ];
      });
    return {
      entries: { count: entries.length, changed: changes(entries) },
      adapted: {
        count: adapted.size,
        changed: changes(adapted.keys(), adapted),
      },
      ported: { count: ported.size, changed: changes(ported.keys(), ported) },
      imported: { count: imported.size, changed: changes(imported) },
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function report(pins, release, sources, budget) {
  const from = pins['framer-motion'];
  const to = release['framer-motion'];
  const repo = 'https://github.com/motiondivision/motion';
  const major = from.split('.')[0] !== to.split('.')[0];
  const list = (group) =>
    group.changed.length
      ? group.changed
          .map(
            (c) =>
              `- \`${c.path}\` (${c.status})${c.owners.length ? ` → ${c.owners.map((o) => `\`${o}\``).join(', ')}` : ''}`,
          )
          .join('\n')
      : '- none';

  let body = `## Background and Goal

Moves the workspace catalog's Motion pins together, to framer-motion ${to}:

| package | from | to |
| --- | --- | --- |
${Object.entries(release)
  .map(([name, version]) => `| \`${name}\` | ${pins[name]} | ${version} |`)
  .join('\n')}

glimmer-motion's \`motion-dom\` and \`motion-utils\` peer ranges follow. The root \`overrides\` resolve framer-motion, motion-dom and motion-utils through the catalog, so the lockfile keeps one copy of each and the page runs one Motion engine.

Upstream: [${from}…${to}](${repo}/compare/v${from}...v${to}), [CHANGELOG](${repo}/blob/v${to}/CHANGELOG.md).${major ? `\n\n**This crosses a major version.** Read upstream's breaking changes before anything else.` : ''}

## Reviewing a Motion bump

\`packages/glimmer-motion/VENDORED.md\` has the procedure. In short:

- **CI.** The Choreo Tests and Choreo Test App Tests jobs run the fidelity suites; Lint runs \`ember-tsc\` over the choreo packages. glimmer-motion's build fails if an inlined module starts importing React or another framer-motion path.
- **Declarations.** \`src/framer-motion-internals.ts\` declares the surface of the inlined entry modules by hand, and the subclasses in \`src/gestures/drag-gesture.ts\` override their methods. A signature change in an entry module below compiles silently against the old declaration, so read those diffs against both files.
- **Adapted code.** Carry a change in an adapted source into the file it names by hand.
- **Ported code.** The Glimmer re-implementations port React modules by hand. Read each diff below against the file it names, and port what applies to Glimmer.
- **Title.** \`fix:\` for a catch-up. Retitle to \`feat:\` when upstream adds a capability glimmer-motion exposes.

## Upstream source changes

From the TypeScript embedded in framer-motion's \`dist/es/**/*.mjs.map\`.

**Entry modules** (${sources.entries.changed.length} of ${sources.entries.count} changed): the modules \`src/framer-motion-internals.ts\` imports.

${list(sources.entries)}

**Adapted** (${sources.adapted.changed.length} of ${sources.adapted.count} changed): the upstream sources glimmer-motion code is adapted from, each with the files adapted from it.

${list(sources.adapted)}

**Ported** (${sources.ported.changed.length} of ${sources.ported.count} changed): the React modules the Glimmer re-implementations port, each with the files that port it.

${list(sources.ported)}

**Modules the entry modules import** (${sources.imported.changed.length} of ${sources.imported.count} changed).

${list(sources.imported)}
`;

  const diffs = [
    ...sources.entries.changed,
    ...sources.adapted.changed,
    ...sources.ported.changed,
    ...sources.imported.changed,
  ];
  if (diffs.length) {
    body += '\n### Diffs\n';
    const omitted = [];
    for (const change of diffs) {
      const section = `\n<details><summary><code>${change.path}</code></summary>\n\n\`\`\`\`diff\n${change.diff}\`\`\`\`\n\n</details>\n`;
      if (body.length + section.length > budget) {
        omitted.push(change.path);
      } else {
        body += section;
      }
    }
    if (omitted.length) {
      body += `\nToo long to include: ${omitted.map((p) => `\`${p}\``).join(', ')}. \`node packages/glimmer-motion/scripts/bump-motion.mjs --to ${to} --report -\` on the pre-bump catalog prints every diff.\n`;
    }
  }
  return body;
}

async function bump(pins, { release, tarballs }) {
  console.log(
    Object.entries(release)
      .map(([name, version]) => `${name}: ${pins[name]} → ${version}`)
      .join('\n'),
  );
  if (args.report) {
    const body = report(
      pins,
      release,
      await compareSources(
        pins['framer-motion'],
        release['framer-motion'],
        tarballs,
      ),
      args.report === '-' ? Infinity : prBodyBudget,
    );
    if (args.report === '-') {
      console.log(`\n${body}`);
    } else {
      writeFileSync(args.report, body);
    }
  }
  if (args.write) {
    writePins(release);
  }
}

const { pins, minimumReleaseAgeMinutes } = readPins();
const picked = await pickRelease(
  pins['framer-motion'],
  minimumReleaseAgeMinutes,
);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${picked?.release['framer-motion'] ?? ''}\nfrom=${pins['framer-motion']}\n`,
  );
}
if (picked) {
  await bump(pins, picked);
} else {
  console.log(`No Motion bump from framer-motion ${pins['framer-motion']}`);
}
