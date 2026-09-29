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
    'Choose a new directory: node scripts/create-tutorial-app.mjs /tmp/my-choreo-app',
  );
}
const write = (name, body) => {
  mkdirSync(dirname(join(target, name)), { recursive: true });
  writeFileSync(join(target, name), body);
};
const read = (name) => readFileSync(join(root, name), 'utf8');
const source = JSON.parse(read('packages/choreo-test-app/package.json'));
const dev = { ...source.devDependencies };
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
        'lint:types': 'glint',
      },
      dependencies: {
        'glimmer-motion': `file:${join(root, 'packages/glimmer-motion')}`,
        'choreo-player': `file:${join(root, 'packages/choreo-player')}`,
        'motion-dom': source.dependencies['motion-dom'],
        'motion-utils': source.dependencies['motion-utils'],
      },
      devDependencies: dev,
      ember: source.ember,
      'ember-addon': source['ember-addon'],
      exports: { './*': './app/*' },
      packageManager: JSON.parse(read('package.json')).packageManager,
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
      glint: { environment: ['ember-loose', 'ember-template-imports'] },
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
console.log(
  `Created ${target}\nRun pnpm install, pnpm build, and pnpm start there. Local package dependencies point to ${root}; build those packages first.`,
);

write(
  'pnpm-workspace.yaml',
  'overrides:\n  vscode-languageserver-protocol: 3.18.2\nallowBuilds:\n  esbuild: true\n  core-js: true\n',
);

write(
  'app/config/environment.js',
  read('packages/choreo-test-app/app/config/environment.js').replaceAll(
    'test-app',
    'choreo-tutorial-app',
  ),
);
