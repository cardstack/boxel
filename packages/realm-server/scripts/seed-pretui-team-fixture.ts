import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  appendReviewEvent,
  captureRepositoryCheckpoint,
  createBranchReview,
  createRepositoryBranch,
  ensureRepositoryMain,
  mergeReview,
  packFromDir,
  publishToStore,
  readBranchHead,
  readRepository,
  readReview,
  readStoreMeta,
  repositoryManifest,
  unpack,
  writeRepositoryConfig,
  type Actor,
} from '@cardstack/deck/node';
import { readTree } from '@cardstack/deck/object-store';

type Layer = 'foundation' | 'layout' | 'control' | 'pattern' | 'field' | 'card';
type DeveloperId = 'mina' | 'jo' | 'ana' | 'leo';
type Phase = 'baseline' | 'candidate' | 'release' | 'next';

interface Artifact {
  id: string;
  className: string;
  layer: Layer;
  owner: DeveloperId;
  introduced: 'baseline' | 'candidate';
}

interface Developer {
  id: DeveloperId;
  name: string;
  actor: Actor;
  reviewer: Actor;
  branch: string;
  title: string;
  summary: string;
}

const packageRRI = '@cardstack/pretui/';
const packageName = 'cardstack/pretui';
const baselineVersion = '0.9.0';
const candidateVersion = '1.0.0-dev.1';
const releaseVersion = '1.0.0';
const nextVersion = '1.1.0-dev.1';
const storeVersions = [
  baselineVersion,
  candidateVersion,
  releaseVersion,
  nextVersion,
];

const developers: Developer[] = [
  {
    id: 'mina',
    name: 'Mina Park',
    actor: { id: '@mina:boxel.test', name: 'Mina Park' },
    reviewer: { id: '@ana:boxel.test', name: 'Ana Costa' },
    branch: 'mina/focus-contract',
    title: 'Make focus visible across every PretUI surface',
    summary:
      'Foundation focus, theme, and surface contracts used by all higher layers.',
  },
  {
    id: 'jo',
    name: 'Jo Bell',
    actor: { id: '@jo:boxel.test', name: 'Jo Bell' },
    reviewer: { id: '@leo:boxel.test', name: 'Leo Wong' },
    branch: 'jo/action-density',
    title: 'Unify compact actions and toolbars',
    summary:
      'Buttons, icon actions, menus, and toolbar density for application chrome.',
  },
  {
    id: 'ana',
    name: 'Ana Costa',
    actor: { id: '@ana:boxel.test', name: 'Ana Costa' },
    reviewer: { id: '@mina:boxel.test', name: 'Mina Park' },
    branch: 'ana/known-date-fields',
    title: 'Carry Known Date through controls and fields',
    summary:
      'Form controls, field definitions, and search behavior consumed by cards.',
  },
  {
    id: 'leo',
    name: 'Leo Wong',
    actor: { id: '@leo:boxel.test', name: 'Leo Wong' },
    reviewer: { id: '@jo:boxel.test', name: 'Jo Bell' },
    branch: 'leo/data-composition',
    title: 'Compose data patterns into production cards',
    summary:
      'Layout, tables, filters, status fields, and the cards that assemble them.',
  },
];

// Twenty-eight real authoring units. The eight baseline units have three
// distinct source states (0.9, 1.0, 1.1); the twenty introduced during the
// 1.0 train have two (1.0, 1.1). The release candidate and stable release
// intentionally share component bytes: promotion is metadata, not a rebuild.
const artifacts: Artifact[] = [
  {
    id: 'foundation/theme-provider',
    className: 'ThemeProvider',
    layer: 'foundation',
    owner: 'mina',
    introduced: 'baseline',
  },
  {
    id: 'foundation/focus-ring',
    className: 'FocusRing',
    layer: 'foundation',
    owner: 'mina',
    introduced: 'baseline',
  },
  {
    id: 'foundation/surface',
    className: 'Surface',
    layer: 'foundation',
    owner: 'mina',
    introduced: 'candidate',
  },
  {
    id: 'layout/stack',
    className: 'Stack',
    layer: 'layout',
    owner: 'mina',
    introduced: 'baseline',
  },
  {
    id: 'layout/cluster',
    className: 'Cluster',
    layer: 'layout',
    owner: 'jo',
    introduced: 'baseline',
  },
  {
    id: 'layout/grid',
    className: 'Grid',
    layer: 'layout',
    owner: 'leo',
    introduced: 'candidate',
  },
  {
    id: 'layout/panel',
    className: 'Panel',
    layer: 'layout',
    owner: 'leo',
    introduced: 'candidate',
  },
  {
    id: 'layout/divider',
    className: 'Divider',
    layer: 'layout',
    owner: 'leo',
    introduced: 'candidate',
  },
  {
    id: 'controls/button',
    className: 'Button',
    layer: 'control',
    owner: 'jo',
    introduced: 'baseline',
  },
  {
    id: 'controls/text-input',
    className: 'TextInput',
    layer: 'control',
    owner: 'ana',
    introduced: 'baseline',
  },
  {
    id: 'controls/icon-button',
    className: 'IconButton',
    layer: 'control',
    owner: 'jo',
    introduced: 'candidate',
  },
  {
    id: 'controls/select',
    className: 'Select',
    layer: 'control',
    owner: 'ana',
    introduced: 'candidate',
  },
  {
    id: 'controls/checkbox',
    className: 'Checkbox',
    layer: 'control',
    owner: 'ana',
    introduced: 'candidate',
  },
  {
    id: 'controls/toggle',
    className: 'Toggle',
    layer: 'control',
    owner: 'ana',
    introduced: 'candidate',
  },
  {
    id: 'controls/menu-button',
    className: 'MenuButton',
    layer: 'control',
    owner: 'jo',
    introduced: 'candidate',
  },
  {
    id: 'controls/toolbar',
    className: 'Toolbar',
    layer: 'control',
    owner: 'jo',
    introduced: 'candidate',
  },
  {
    id: 'controls/known-date',
    className: 'KnownDate',
    layer: 'control',
    owner: 'ana',
    introduced: 'candidate',
  },
  {
    id: 'controls/search-field',
    className: 'SearchField',
    layer: 'control',
    owner: 'ana',
    introduced: 'candidate',
  },
  {
    id: 'patterns/form-field',
    className: 'FormField',
    layer: 'pattern',
    owner: 'ana',
    introduced: 'baseline',
  },
  {
    id: 'patterns/empty-state',
    className: 'EmptyState',
    layer: 'pattern',
    owner: 'leo',
    introduced: 'baseline',
  },
  {
    id: 'patterns/filter-bar',
    className: 'FilterBar',
    layer: 'pattern',
    owner: 'leo',
    introduced: 'candidate',
  },
  {
    id: 'patterns/data-table',
    className: 'DataTable',
    layer: 'pattern',
    owner: 'leo',
    introduced: 'candidate',
  },
  {
    id: 'fields/known-date-field',
    className: 'KnownDateField',
    layer: 'field',
    owner: 'ana',
    introduced: 'candidate',
  },
  {
    id: 'fields/status-field',
    className: 'StatusField',
    layer: 'field',
    owner: 'leo',
    introduced: 'candidate',
  },
  {
    id: 'fields/country-field',
    className: 'CountryField',
    layer: 'field',
    owner: 'leo',
    introduced: 'candidate',
  },
  {
    id: 'cards/customer-profile',
    className: 'CustomerProfile',
    layer: 'card',
    owner: 'leo',
    introduced: 'candidate',
  },
  {
    id: 'cards/design-review',
    className: 'DesignReview',
    layer: 'card',
    owner: 'leo',
    introduced: 'candidate',
  },
  {
    id: 'cards/release-train',
    className: 'ReleaseTrain',
    layer: 'card',
    owner: 'leo',
    introduced: 'candidate',
  },
];

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function title(id: string): string {
  return id
    .split('/')
    .at(-1)!
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function componentModule(artifact: Artifact, sourceVersion: string): string {
  let label = title(artifact.id);
  return `
import { Component } from '@cardstack/base/card-api';
import { or } from '@cardstack/boxel-ui/helpers';

interface ${artifact.className}Signature {
  Element: HTMLElement;
  Args: { label?: string; detail?: string };
  Blocks: { default: [] };
}

export class ${artifact.className} extends Component<${artifact.className}Signature> {
  sourceVersion = '${sourceVersion}';

  <template>
    <section class='pretui-unit pretui-${artifact.layer}' data-pretui-unit='${artifact.id}' ...attributes>
      <span class='pretui-unit__label'>{{or @label '${label}'}}</span>
      {{#if @detail}}<small>{{@detail}}</small>{{/if}}
      {{yield}}
    </section>
    <style scoped>
      .pretui-unit { display: flex; align-items: center; gap: .5rem; min-height: 2.5rem; padding: .55rem .75rem; border: 1px solid #dce4e2; border-radius: .65rem; background: #fff; color: #17231f; font-family: Inter, system-ui, sans-serif; }
      .pretui-unit__label { font-weight: 680; }
      small { margin-left: auto; color: #718079; }
    </style>
  </template>
}
`.trimStart();
}

function fieldModule(artifact: Artifact, sourceVersion: string): string {
  let control = artifact.id.includes('known-date')
    ? "import { KnownDate } from '../controls/known-date.gts';"
    : artifact.id.includes('status')
      ? "import { Toggle } from '../controls/toggle.gts';"
      : "import { Select } from '../controls/select.gts';";
  let controlName = artifact.id.includes('known-date')
    ? 'KnownDate'
    : artifact.id.includes('status')
      ? 'Toggle'
      : 'Select';
  return `
import { Component, FieldDef } from '@cardstack/base/card-api';
${control}

export class ${artifact.className} extends FieldDef {
  static displayName = '${title(artifact.id)}';
  static sourceVersion = '${sourceVersion}';

  static embedded = class Embedded extends Component<typeof this> {
    <template><${controlName} @label='${title(artifact.id)}' @detail='PretUI ${sourceVersion}' /></template>
  };
}
`.trimStart();
}

function ordinaryCardModule(artifact: Artifact, sourceVersion: string): string {
  let pattern = artifact.id.includes('customer') ? 'FormField' : 'Panel';
  let patternPath = artifact.id.includes('customer')
    ? '../patterns/form-field.gts'
    : '../layout/panel.gts';
  return `
import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { ${pattern} } from '${patternPath}';

export class ${artifact.className} extends CardDef {
  static displayName = '${title(artifact.id)}';
  static sourceVersion = '${sourceVersion}';
  @field title = contains(StringField);
  @field status = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <${pattern} @label={{@model.title}} @detail={{@model.status}} />
    </template>
  };
}
`.trimStart();
}

function releaseTrainCard(sourceVersion: string): string {
  return `
import { CardDef, Component } from '@cardstack/base/card-api';

export class ReleaseTrain extends CardDef {
  static displayName = 'PretUI Release Train';
  static sourceVersion = '${sourceVersion}';

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='train'>
        <header>
          <div><span class='eyebrow'>PRETUI · TEAM RELEASE 1.0</span><h1>One system, four layers of work.</h1></div>
          <div class='version'><span>main</span><strong>1.0.0</strong><small>latest</small></div>
        </header>
        <section class='flow' aria-label='Release flow'>
          <div><b>4</b><span>branches</span></div><i>→</i><div><b>4</b><span>component Reviews</span></div><i>→</i><div><b>1</b><span>release Review</span></div><i>→</i><div class='live'><b>28</b><span>units on main</span></div>
        </section>
        <main>
          <section class='lane mina'><span>FOUNDATION</span><h2>Mina · focus contract</h2><p>Theme provider, focus ring, surface, and stack.</p><code>mina/focus-contract</code></section>
          <section class='lane jo'><span>ACTIONS</span><h2>Jo · compact actions</h2><p>Buttons, icon actions, menus, cluster, and toolbar.</p><code>jo/action-density</code></section>
          <section class='lane ana'><span>FIELDS</span><h2>Ana · Known Date</h2><p>Controls flow into real FieldDefs consumed by cards.</p><code>ana/known-date-fields</code></section>
          <section class='lane leo'><span>COMPOSITION</span><h2>Leo · production cards</h2><p>Grid, data patterns, fields, and composed card UI.</p><code>leo/data-composition</code></section>
        </main>
        <footer>
          <div><span>candidate lock</span><code>@cardstack/pretui@1.0.0-dev.1/</code></div>
          <div><span>stable on main</span><code>@cardstack/pretui@1.0.0/</code></div>
          <div><span>next develop lock</span><code>@cardstack/pretui@1.1.0-dev.1/</code></div>
        </footer>
      </article>
      <style scoped>
        .train { --ink: #16221e; --muted: #6d7b75; --line: #d9e3df; --mint: #b8f4d5; max-width: 70rem; overflow: hidden; border: 1px solid var(--line); border-radius: 1.4rem; background: #f6faf8; color: var(--ink); box-shadow: 0 1.5rem 4rem rgb(22 34 30 / 12%); font-family: Inter, system-ui, sans-serif; }
        header { display: flex; justify-content: space-between; gap: 2rem; padding: 2rem; background: #14241f; color: #f8fffb; } .eyebrow { color: #8fe2bb; font: 700 .68rem/1.2 ui-monospace, monospace; letter-spacing: .15em; } h1 { margin: .45rem 0 0; font-size: clamp(1.8rem, 4vw, 3.2rem); letter-spacing: -.055em; } .version { display: grid; align-content: center; justify-items: end; min-width: 8rem; } .version span,.version small { color: #9fb1aa; font: .68rem ui-monospace, monospace; } .version strong { font-size: 1.5rem; }
        .flow { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr; align-items: center; gap: .7rem; padding: 1rem 2rem; border-bottom: 1px solid var(--line); background: #fff; } .flow div { display: flex; align-items: baseline; gap: .55rem; } .flow b { font-size: 1.35rem; } .flow span { color: var(--muted); font-size: .75rem; } .flow i { color: #9aaba4; font-style: normal; } .flow .live b { color: #087a4f; }
        main { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; padding: 1rem; } .lane { min-height: 9rem; padding: 1.1rem; border: 1px solid var(--line); border-radius: 1rem; background: #fff; } .lane > span { color: #698078; font: 700 .62rem ui-monospace, monospace; letter-spacing: .13em; } .lane h2 { margin: .6rem 0 .35rem; font-size: 1rem; } .lane p { min-height: 2.5rem; margin: 0 0 .8rem; color: var(--muted); font-size: .78rem; line-height: 1.55; } code { padding: .22rem .38rem; border-radius: .35rem; background: #edf4f1; color: #335148; font: .67rem ui-monospace, monospace; }
        footer { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; border-top: 1px solid var(--line); background: var(--line); } footer div { display: grid; gap: .45rem; padding: 1rem; background: #fff; } footer span { color: var(--muted); font-size: .65rem; text-transform: uppercase; } footer code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        @media (max-width: 48rem) { header { flex-direction: column; } .version { justify-items: start; } .flow { grid-template-columns: 1fr 1fr; } .flow i { display: none; } main, footer { grid-template-columns: 1fr; } }
      </style>
    </template>
  };
}
`.trimStart();
}

function artifactModule(artifact: Artifact, sourceVersion: string): string {
  if (artifact.id === 'cards/release-train')
    return releaseTrainCard(sourceVersion);
  if (artifact.layer === 'field') return fieldModule(artifact, sourceVersion);
  if (artifact.layer === 'card')
    return ordinaryCardModule(artifact, sourceVersion);
  return componentModule(artifact, sourceVersion);
}

function workspaceFiles(phase: Phase): Record<string, string> {
  let requested =
    phase === 'baseline' || phase === 'release' ? 'latest' : 'dev';
  let exact =
    phase === 'baseline'
      ? baselineVersion
      : phase === 'candidate'
        ? candidateVersion
        : phase === 'release'
          ? releaseVersion
          : nextVersion;
  return Object.fromEntries(
    developers.flatMap((developer) => [
      [
        `workspaces/${developer.id}/package.json`,
        json({
          name: `@pretui-lab/${developer.id}-workbench`,
          private: true,
          dependencies: { '@cardstack/pretui': requested },
        }),
      ],
      [
        `workspaces/${developer.id}/importmap.json`,
        json({
          imports: { '@cardstack/pretui': `@cardstack/pretui@${exact}/` },
          scopes: {},
        }),
      ],
    ]),
  );
}

function stateFor(options: {
  phase: Phase;
  owners?: Set<DeveloperId>;
}): Map<string, string> {
  let sourceVersion =
    options.phase === 'baseline'
      ? baselineVersion
      : options.phase === 'next'
        ? nextVersion
        : releaseVersion;
  let included = artifacts.filter((artifact) => {
    if (artifact.introduced === 'baseline') return true;
    return (
      options.phase !== 'baseline' &&
      (!options.owners || options.owners.has(artifact.owner))
    );
  });
  let files = new Map<string, string>();
  files.set(
    'package.json',
    json({
      name: '@cardstack/pretui',
      version:
        options.phase === 'baseline'
          ? baselineVersion
          : options.phase === 'next'
            ? '1.1.0'
            : releaseVersion,
      type: 'module',
      exports: { './*': './*.gts' },
      dependencies: {
        '@cardstack/base': '^1.0.0',
        '@cardstack/boxel-ui': '>=0.0.0',
      },
    }),
  );
  files.set(
    'importmap.json',
    json({
      imports: {
        '@cardstack/base': '@cardstack/base@1.0.0/',
        '@cardstack/boxel-ui': '@cardstack/boxel-ui@0.0.0/',
      },
      scopes: {},
    }),
  );
  files.set(
    'realm.json',
    json({
      data: {
        type: 'card',
        attributes: { cardInfo: { name: 'PretUI Team Lab' } },
        meta: {
          adoptsFrom: {
            module: '@cardstack/base/realm-config',
            name: 'RealmConfig',
          },
        },
      },
    }),
  );
  files.set(
    'index.json',
    json({
      data: {
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: { module: './cards/release-train', name: 'ReleaseTrain' },
        },
      },
    }),
  );
  files.set(
    'TEAM_SCENARIO.json',
    json({
      format: 'pretui-team-collaboration-v1',
      artifacts: artifacts.length,
      componentStates: {
        baselineUnitsWithThreeStates: 8,
        candidateUnitsWithTwoStates: 20,
      },
      flow: [
        'developer branches',
        'component Reviews',
        'dev candidate',
        'release Review',
        'latest stable',
        'next dev lock',
      ],
    }),
  );
  for (let artifact of included) {
    let artifactVersion =
      options.phase === 'candidate' &&
      options.owners &&
      !options.owners.has(artifact.owner)
        ? baselineVersion
        : sourceVersion;
    files.set(`${artifact.id}.gts`, artifactModule(artifact, artifactVersion));
  }
  for (let [path, content] of Object.entries(workspaceFiles(options.phase))) {
    if (
      !options.owners ||
      path === 'package.json' ||
      path === 'importmap.json'
    ) {
      files.set(path, content);
      continue;
    }
    let developer = path.split('/')[1] as DeveloperId;
    let baseline = workspaceFiles('baseline')[path];
    files.set(path, options.owners.has(developer) ? content : baseline);
  }
  return files;
}

async function assertEmptyTarget(realmDir: string): Promise<void> {
  await mkdir(realmDir, { recursive: true });
  let entries = await readdir(realmDir);
  if (entries.length > 0) {
    throw new Error(`PretUI team fixture target must be empty: ${realmDir}`);
  }
}

let writtenPaths = new Set<string>();
async function writeState(
  realmDir: string,
  state: Map<string, string>,
): Promise<void> {
  for (let path of writtenPaths) {
    await rm(join(realmDir, ...path.split('/')), { force: true });
  }
  writtenPaths = new Set(state.keys());
  for (let [path, content] of state) {
    let destination = join(realmDir, ...path.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

function checkpointInputs(label: string) {
  return {
    historyHead: `history:${sha(`history:${label}`).slice(0, 24)}`,
    indexGenerationHash: sha(`index:${label}`),
  };
}

async function publishCurrent(
  realmDir: string,
  version: string,
  tag: 'latest' | 'dev',
  at: string,
) {
  let bytes = await packFromDir(realmDir, {
    package: packageName,
    version,
    mode: 'bare',
    toolchain: { fixture: 'pretui-team-collaboration-v1' },
  });
  let record = await publishToStore(
    join(realmDir, '.deck', 'store'),
    packageName,
    version,
    bytes,
    {
      tag,
      now: new Date(at),
    },
  );
  return { treeHash: record.treeHash, bytes };
}

async function assertHeadMatchesAuthored(
  realmDir: string,
  branch: string,
): Promise<string> {
  let head = await readBranchHead(realmDir, branch);
  if (!head) throw new Error(`missing ${branch} branch`);
  let repository = await readRepository(realmDir, head.repositoryHash);
  if (!repository) throw new Error(`missing Repository for ${branch}`);
  let authoredTree = unpack(await packFromDir(realmDir)).treeHash;
  if (repository.members[packageRRI] !== authoredTree) {
    throw new Error(`${branch} does not match the authored PretUI tree`);
  }
  return authoredTree;
}

let args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (!args[0]) {
  throw new Error(
    'usage: node scripts/seed-pretui-team-fixture.ts <empty-realm-dir>',
  );
}
let realmDir = resolve(args[0]);
await assertEmptyTarget(realmDir);

let events: Record<string, unknown>[] = [];
let fixtureActor: Actor = { id: '@fixture:boxel.test', name: 'PretUI Fixture' };
let releaseActor: Actor = { id: '@rhea:boxel.test', name: 'Rhea Singh' };
let config = repositoryManifest({
  roots: [packageRRI],
  members: { [packageRRI]: '.' },
});

let baseline = stateFor({ phase: 'baseline' });
await writeState(realmDir, baseline);
await writeRepositoryConfig(realmDir, config);
let baselinePublished = await publishCurrent(
  realmDir,
  baselineVersion,
  'latest',
  '2026-08-24T08:00:00.000Z',
);
let mainBaseCheckpoint = await ensureRepositoryMain({
  realmDir,
  config,
  author: fixtureActor,
  ...checkpointInputs('main-0.9.0'),
});
await createRepositoryBranch({ realmDir, branch: 'develop' });
for (let developer of developers) {
  await createRepositoryBranch({
    realmDir,
    branch: developer.branch,
    from: 'develop',
  });
}
events.push({
  action: 'initialize',
  branch: 'main',
  version: baselineVersion,
  checkpoint: mainBaseCheckpoint,
});

let componentReviews: number[] = [];
for (let [index, developer] of developers.entries()) {
  let authoredHour = String(9 + index).padStart(2, '0');
  let branchState = stateFor({
    phase: 'candidate',
    owners: new Set([developer.id]),
  });
  await writeState(realmDir, branchState);
  let source = await captureRepositoryCheckpoint({
    realmDir,
    config,
    branch: developer.branch,
    message: developer.title,
    author: developer.actor,
    createdAt: `2026-08-24T${authoredHour}:00:00.000Z`,
    ...checkpointInputs(developer.branch),
  });
  let opened = await createBranchReview({
    realmDir,
    repository: packageRRI,
    sourceBranch: developer.branch,
    targetBranch: 'develop',
    baseCheckpointHash: mainBaseCheckpoint,
    title: developer.title,
    body: developer.summary,
    author: developer.actor,
    createdAt: `2026-08-24T${13 + index}:00:00.000Z`,
  });
  await appendReviewEvent({
    realmDir,
    number: opened.ref.number,
    type: 'reviewed',
    actor: developer.reviewer,
    verdict: 'approved',
    checkpointHash: source.checkpointHash,
    createdAt: `2026-08-24T${13 + index}:20:00.000Z`,
  });
  let merged = await mergeReview({
    realmDir,
    number: opened.ref.number,
    actor: developer.reviewer,
    createdAt: `2026-08-24T${13 + index}:30:00.000Z`,
    ...checkpointInputs(`merge:${developer.branch}`),
  });
  if (merged.state !== 'ready') {
    throw new Error(
      `fixture Review #${opened.ref.number} conflicted: ${merged.conflicts.join(', ')}`,
    );
  }
  componentReviews.push(opened.ref.number);
  events.push({
    action: 'review-merged',
    number: opened.ref.number,
    source: developer.branch,
    target: 'develop',
    checkpoint: merged.mergeCheckpointHash,
  });
}

let candidate = stateFor({
  phase: 'candidate',
  owners: new Set(developers.map(({ id }) => id)),
});
await writeState(realmDir, candidate);
let candidateTree = await assertHeadMatchesAuthored(realmDir, 'develop');
let candidatePublished = await publishCurrent(
  realmDir,
  candidateVersion,
  'dev',
  '2026-08-24T18:00:00.000Z',
);
if (candidatePublished.treeHash !== candidateTree)
  throw new Error('dev Version differs from develop branch');
let beforeRelease = await readStoreMeta(
  join(realmDir, '.deck', 'store'),
  packageName,
);
if (
  beforeRelease?.tags.latest !== baselineVersion ||
  beforeRelease.tags.dev !== candidateVersion
) {
  throw new Error(
    'main/latest and develop/dev tags do not express the release boundary',
  );
}
events.push({
  action: 'publish-dev',
  version: candidateVersion,
  tag: 'dev',
  treeHash: candidateTree,
  mainLatest: baselineVersion,
});

let release = stateFor({ phase: 'release' });
await writeState(realmDir, release);
let releaseSource = await captureRepositoryCheckpoint({
  realmDir,
  config,
  branch: 'develop',
  message: 'Lock consuming workbenches to the 1.0.0 release',
  author: releaseActor,
  createdAt: '2026-08-24T18:30:00.000Z',
  ...checkpointInputs('develop-release-locks'),
});
let releaseReview = await createBranchReview({
  realmDir,
  repository: packageRRI,
  sourceBranch: 'develop',
  targetBranch: 'main',
  baseCheckpointHash: mainBaseCheckpoint,
  title: 'Release PretUI 1.0 across components, fields, and cards',
  body: 'Promote the exact develop candidate after all four layer Reviews and consumer previews passed.',
  author: releaseActor,
  createdAt: '2026-08-24T19:00:00.000Z',
});
await appendReviewEvent({
  realmDir,
  number: releaseReview.ref.number,
  type: 'reviewed',
  actor: fixtureActor,
  verdict: 'approved',
  checkpointHash: releaseSource.checkpointHash,
  createdAt: '2026-08-24T19:20:00.000Z',
});
let releaseMerge = await mergeReview({
  realmDir,
  number: releaseReview.ref.number,
  actor: releaseActor,
  createdAt: '2026-08-24T19:30:00.000Z',
  ...checkpointInputs('merge:release-1.0.0'),
});
if (releaseMerge.state !== 'ready') {
  throw new Error(
    `release Review conflicted: ${releaseMerge.conflicts.join(', ')}`,
  );
}
let releaseTree = await assertHeadMatchesAuthored(realmDir, 'main');
let stablePublished = await publishCurrent(
  realmDir,
  releaseVersion,
  'latest',
  '2026-08-24T20:00:00.000Z',
);
if (stablePublished.treeHash !== releaseTree)
  throw new Error('latest Version differs from main');
events.push({
  action: 'release-merged',
  number: releaseReview.ref.number,
  version: releaseVersion,
  tag: 'latest',
  checkpoint: releaseMerge.mergeCheckpointHash,
});

await createRepositoryBranch({ realmDir, branch: 'develop/1.1', from: 'main' });
let next = stateFor({ phase: 'next' });
await writeState(realmDir, next);
let nextCheckpoint = await captureRepositoryCheckpoint({
  realmDir,
  config,
  branch: 'develop/1.1',
  message: 'Open 1.1 development and refresh every workbench lock',
  author: releaseActor,
  createdAt: '2026-08-25T08:00:00.000Z',
  ...checkpointInputs('develop-1.1'),
});
let nextTree = await assertHeadMatchesAuthored(realmDir, 'develop/1.1');
let nextPublished = await publishCurrent(
  realmDir,
  nextVersion,
  'dev',
  '2026-08-25T08:30:00.000Z',
);
if (nextPublished.treeHash !== nextTree)
  throw new Error('next dev Version differs from develop/1.1');
events.push({
  action: 'next-development',
  branch: 'develop/1.1',
  version: nextVersion,
  tag: 'dev',
  checkpoint: nextCheckpoint.checkpointHash,
});

// The mutable realm root is main. The next branch remains independently
// addressable through its exact Repository/Checkpoint and the dev Version.
await writeState(realmDir, release);
await assertHeadMatchesAuthored(realmDir, 'main');

let meta = await readStoreMeta(join(realmDir, '.deck', 'store'), packageName);
if (!meta || storeVersions.some((version) => !meta.versions[version])) {
  throw new Error('fixture did not publish every expected PretUI Version');
}
if (meta.tags.latest !== releaseVersion || meta.tags.dev !== nextVersion) {
  throw new Error('final latest/dev tags are incorrect');
}
let reviews = await Promise.all(
  [...componentReviews, releaseReview.ref.number].map((number) =>
    readReview(realmDir, number),
  ),
);
if (reviews.some((review) => review?.ref.state !== 'merged')) {
  throw new Error('every fixture Review must finish merged');
}

let report = {
  format: 'pretui-team-collaboration-v1',
  packageRRI,
  artifactCount: artifacts.length,
  layers: Object.fromEntries(
    [...new Set(artifacts.map(({ layer }) => layer))].map((layer) => [
      layer,
      artifacts.filter((artifact) => artifact.layer === layer).length,
    ]),
  ),
  componentStates: {
    three: artifacts.filter(({ introduced }) => introduced === 'baseline')
      .length,
    two: artifacts.filter(({ introduced }) => introduced === 'candidate')
      .length,
  },
  developers: developers.map((developer) => ({
    id: developer.id,
    name: developer.name,
    branch: developer.branch,
  })),
  reviews: reviews.map((review) => ({
    number: review!.ref.number,
    title: review!.review.title,
    state: review!.ref.state,
    events: review!.events.map(({ type }) => type),
  })),
  versions: Object.fromEntries(
    storeVersions.map((version) => [version, meta!.versions[version].treeHash]),
  ),
  tags: meta.tags,
  branches: {
    main: await readBranchHead(realmDir, 'main'),
    develop: await readBranchHead(realmDir, 'develop'),
    next: await readBranchHead(realmDir, 'develop/1.1'),
  },
  locks: {
    candidate: `@cardstack/pretui@${candidateVersion}/`,
    main: `@cardstack/pretui@${releaseVersion}/`,
    next: `@cardstack/pretui@${nextVersion}/`,
  },
  baselineTree: baselinePublished.treeHash,
};
await mkdir(join(realmDir, '.deck', 'fixtures'), { recursive: true });
await writeFile(
  join(realmDir, '.deck', 'fixtures', 'pretui-team.json'),
  json(report),
);
await writeFile(
  join(realmDir, '.deck', 'fixtures', 'pretui-team.ndjson'),
  `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
);

// Touch the tree manifest in the final assertion path so fixture corruption
// is caught even when every referenced object happens to exist.
for (let treeHash of Object.values(report.versions)) {
  if (!(await readTree(join(realmDir, '.deck', 'store'), treeHash))) {
    throw new Error(`missing stored tree ${treeHash}`);
  }
}

console.log(JSON.stringify(report, null, 2));
