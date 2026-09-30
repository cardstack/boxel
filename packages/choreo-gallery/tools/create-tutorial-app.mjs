import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Generate a clean Ember/Vite consumer, not a copy of the gallery application.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const target = process.argv[2] && resolve(process.argv[2]);
if (!target || existsSync(target)) {
  throw new Error(
    'Choose a new directory: node packages/choreo-gallery/tools/create-tutorial-app.mjs /tmp/my-choreo-app',
  );
}
const write = (name, body) => {
  mkdirSync(dirname(join(target, name)), { recursive: true });
  writeFileSync(join(target, name), body);
};
const read = (name) => readFileSync(join(root, name), 'utf8');

// The generated app is its own pnpm workspace, where `catalog:` means
// nothing, so each catalog specifier becomes the range pnpm-workspace.yaml
// gives it. The catalog is a flat block of `name: range` lines.
const catalog = {};
let inCatalog = false;
for (const line of read('pnpm-workspace.yaml').split('\n')) {
  if (/^\S/.test(line)) {
    inCatalog = line.trimEnd() === 'catalog:';
    continue;
  }
  const entry = inCatalog && line.match(/^\s+("[^"]+"|[^\s#"]\S*):\s*(\S+)/);
  if (entry) {
    catalog[entry[1].replace(/^"|"$/g, '')] = entry[2].replace(/^"|"$/g, '');
  }
}
const resolveCatalog = (dependencies) =>
  Object.fromEntries(
    Object.entries(dependencies).map(([name, specifier]) => {
      if (specifier !== 'catalog:') {
        return [name, specifier];
      }
      if (!catalog[name]) {
        throw new Error(`${name} is not in the pnpm-workspace.yaml catalog`);
      }
      return [name, catalog[name]];
    }),
  );

// The app installs the libraries from tarballs, which pnpm pack builds (via
// each package's prepack) and writes with catalog: and workspace:
// specifiers already resolved, so the app doesn't depend on the checkout.
const pack = (name) => {
  mkdirSync(join(target, 'vendor'), { recursive: true });
  execFileSync(
    'pnpm',
    ['pack', '--out', join(target, 'vendor', `${name}.tgz`)],
    {
      cwd: join(root, 'packages', name),
      stdio: 'inherit',
    },
  );
  return `file:./vendor/${name}.tgz`;
};

// A directory outside the checkout doesn't see its .mise.toml, so the app
// carries the same Node and pnpm pins.
const tools = Object.fromEntries(
  [...read('.mise.toml').matchAll(/^(node|pnpm) = "([^"]+)"$/gm)].map(
    ([, tool, version]) => [tool, version],
  ),
);
const rootPackage = JSON.parse(read('package.json'));
const source = JSON.parse(read('packages/choreo-test-app/package.json'));
const dev = { ...source.devDependencies };
const dependencies = resolveCatalog({
  'motion-dom': source.dependencies['motion-dom'],
  'motion-utils': source.dependencies['motion-utils'],
});
for (const key of [
  '@chenglou/pretext',
  '@types/three',
  'qunit',
  'qunit-dom',
  '@types/qunit',
  'ember-qunit',
  '@ember/test-helpers',
  'ember-cli-deprecation-workflow',
]) {
  delete dev[key];
}
write(
  'package.json',
  JSON.stringify(
    {
      name: 'choreo-tutorial-app',
      version: '0.0.0',
      private: true,
      scripts: {
        start: 'vite --host 127.0.0.1 --port 4600',
        build: 'vite build',
        'lint:types': 'ember-tsc --noEmit',
      },
      dependencies: {
        'glimmer-motion': pack('glimmer-motion'),
        'choreo-player': pack('choreo-player'),
        ...dependencies,
      },
      devDependencies: resolveCatalog(dev),
      ember: source.ember,
      'ember-addon': source['ember-addon'],
      exports: { './*': './app/*' },
      engines: rootPackage.engines,
      devEngines: rootPackage.devEngines,
      packageManager: `pnpm@${tools.pnpm}`,
    },
    null,
    2,
  ),
);
for (const file of [
  'babel.config.cjs',
  'ember-cli-build.js',
  'config/optional-features.json',
  'app/config/environment.d.ts',
]) {
  write(file, read(`packages/choreo-test-app/${file}`));
}
write(
  'config/environment.js',
  read('packages/choreo-test-app/config/environment.js').replaceAll(
    'test-app',
    'choreo-tutorial-app',
  ),
);
write('app/app.ts', read('packages/choreo-test-app/app/app.ts'));
write(
  'tsconfig.json',
  JSON.stringify(
    {
      extends: '@ember/app-tsconfig',
      include: ['app', 'types'],
      compilerOptions: {
        allowJs: true,
        noEmitOnError: false,
        declaration: false,
        declarationMap: false,
        allowImportingTsExtensions: true,
        types: ['ember-source/types'],
        paths: { 'choreo-tutorial-app/*': ['./app/*'] },
      },
    },
    null,
    2,
  ),
);
write(
  'types/index.d.ts',
  '/// <reference types="@embroider/core/virtual" />\n/// <reference types="vite/client" />\n',
);
write(
  'vite.config.mjs',
  `import { classicEmberSupport, ember, extensions } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [classicEmberSupport(), ember(), babel({ babelHelpers: 'runtime', extensions })] });\n`,
);
write(
  'index.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choreo tutorials</title>{{content-for "head"}}{{content-for "head-footer"}}</head><body>{{content-for "body"}}<script type="module">import Application from './app/app';import environment from './app/config/environment';Application.create(environment.APP);</script>{{content-for "body-footer"}}</body></html>`,
);
write(
  'app/router.ts',
  `import Router from '@embroider/router';\nexport default class TutorialRouter extends Router { location = 'history' as const; rootURL = '/'; }\nTutorialRouter.map(function(){ this.route('spatial'); this.route('film'); });\n`,
);
write(
  'app/templates/application.gts',
  `import { LinkTo } from '@ember/routing';\n<template><header><LinkTo @route="index">Task board</LinkTo> · <LinkTo @route="spatial">Spatial card</LinkTo> · <LinkTo @route="film">Recordable scene</LinkTo></header><main>{{outlet}}</main><style>body{margin:0;background:#181513;color:#f2ebe4;font-family:system-ui}header{padding:20px}a{color:#efab7a}main{max-width:960px;margin:auto;padding:24px}body:has([data-tutorial-film]) header{display:none}body:has([data-tutorial-film]) main{max-width:none;padding:0}</style></template>`,
);
for (const [route, file, name] of [
  ['index', 'task-board', 'TaskBoard'],
  ['spatial', 'spatial-card', 'SpatialCard'],
  ['film', 'recordable-scene', 'RecordableScene'],
]) {
  const destination = join(target, 'app/components', `${file}.gts`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(
    join(
      root,
      'packages/choreo-test-app/app/components/tutorials',
      `${file}.gts`,
    ),
    destination,
  );
  write(
    `app/templates/${route}.gts`,
    `import { ${name} } from '../components/${file}';\n<template><${name} /></template>\n`,
  );
}
write(
  'pnpm-workspace.yaml',
  'allowBuilds:\n  esbuild: true\n  core-js: true\n',
);
write(
  '.mise.toml',
  `[tools]\nnode = "${tools.node}"\npnpm = "${tools.pnpm}"\n`,
);

write(
  'app/config/environment.js',
  read('packages/choreo-test-app/app/config/environment.js').replaceAll(
    'test-app',
    'choreo-tutorial-app',
  ),
);

console.log(
  `Created ${target}\nRun mise trust, pnpm install, pnpm build, and pnpm start there.`,
);
