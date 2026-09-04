import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const realm = join(packageRoot, 'dist-realm');
const readJson = (path) => JSON.parse(readFileSync(join(realm, path), 'utf8'));
const manifest = readJson('gallery-manifest.generated');

test('the unlisted comparison realm asks crawlers not to index it', () => {
  assert.equal(
    readFileSync(join(realm, 'robots.txt'), 'utf8'),
    'User-agent: *\nDisallow: /\n',
  );
});

test('the generated realm covers the canonical 45-demo catalog exactly once', () => {
  assert.equal(manifest.demoCount, 45);
  assert.equal(new Set(manifest.ids).size, 45);
  for (const id of manifest.ids) {
    const card = readJson(`demos/${id}.json`);
    assert.equal(card.data.attributes.demoId, id);
    assert.equal(card.data.meta.adoptsFrom.module, '../site');
    assert.equal(card.data.meta.adoptsFrom.name, 'ChoreoDemo');
    assert.ok(
      card.data.attributes.sample.length > 0,
      `${id} has its GTS sample`,
    );
    assert.ok(card.data.attributes.apis.length > 0, `${id} has API tags`);
  }
});

test('host routes and ordered gallery relationships include every demo', () => {
  const config = readJson('realm.json').data;
  assert.match(config.attributes.iconURL, /\/icon\.svg$/);
  assert.match(config.attributes.backgroundURL, /\/og\.png$/);
  const paths = config.attributes.hostRoutingRules.map(({ path }) => path);
  assert.deepEqual(paths, ['/', ...manifest.ids.map((id) => `/${id}`)]);
  paths.forEach((_path, index) => {
    assert.equal(
      config.relationships[`hostRoutingRules.${index}.instance`].links.self,
      './index',
    );
  });

  const index = readJson('index.json').data;
  manifest.ids.forEach((id, position) => {
    assert.equal(
      index.relationships[`demos.${position}`].links.self,
      `./demos/${id}`,
    );
  });
  assert.equal(index.relationships['cardInfo.theme'].links.self, './theme');
});

test('the gallery and demo cards use the native Boxel theme contract', () => {
  const theme = readJson('theme.json').data;
  assert.deepEqual(theme.meta.adoptsFrom, {
    module: 'https://cardstack.com/base/card-api',
    name: 'Theme',
  });
  assert.match(theme.attributes.cssVariables, /:root\s*{/);
  assert.match(theme.attributes.cssVariables, /\.dark\s*{/);
  assert.match(theme.attributes.cssVariables, /--background:/);
  assert.match(theme.attributes.cssVariables, /--foreground:/);
  assert.ok(theme.attributes.cssImports.length > 0);
  assert.equal(
    readJson('demos/playhead.json').data.relationships['cardInfo.theme'].links
      .self,
    '../theme',
  );
});

test('runtime is content-addressed and the stable shim selects that hash', () => {
  const runtime = readFileSync(join(realm, manifest.runtime), 'utf8');
  const actual = createHash('sha256').update(runtime).digest('hex');
  assert.equal(actual, manifest.runtimeSha256);
  assert.match(
    readFileSync(join(realm, 'gallery-runtime.ts'), 'utf8'),
    new RegExp(actual.slice(0, 12)),
  );
});

test('every gallery style is constrained to its local mount boundary', () => {
  const css = readFileSync(join(packageRoot, 'styles/app.scoped.css'), 'utf8');
  const escaped = [];
  const rootSelectors = [];
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && /(?:^|-)keyframes$/i.test(parent.name)) {
        return;
      }
    }
    for (const selector of rule.selectors) {
      if (!selector.includes('.choreo-site')) {
        escaped.push(selector);
      }
      if (selector.includes(':root')) {
        rootSelectors.push(selector);
      }
    }
  });
  assert.deepEqual(escaped, []);
  assert.deepEqual(rootSelectors, []);
  assert.match(css, /\.choreo-site\[data-theme='light'\]/);
  assert.match(css, /html\[data-gm-dragging\] \.choreo-site/);

  const site = readFileSync(join(realm, 'site.gts'), 'utf8');
  const start = site.indexOf('<style>') + '<style>'.length;
  const end = site.indexOf('</style>', start);
  const bundled = postcss.parse(site.slice(start, end));
  const unscopedRuntimeRules = [];
  bundled.walkRules((rule) => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && /(?:^|-)keyframes$/i.test(parent.name)) {
        return;
      }
    }
    for (const selector of rule.selectors) {
      if (
        !selector.includes('.choreo-site') &&
        !selector.includes('[data-scopedcss-')
      ) {
        unscopedRuntimeRules.push(selector);
      }
    }
  });
  assert.deepEqual(unscopedRuntimeRules, []);
  const components = join(packageRoot, 'src/components');
  for (const file of readdirSync(components, { recursive: true }).filter(
    (name) => name.endsWith('.gts'),
  )) {
    const source = readFileSync(join(components, file), 'utf8');
    for (const [, styles] of source.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
      postcss.parse(styles).walkRules((rule) => {
        for (let parent = rule.parent; parent; parent = parent.parent) {
          if (
            parent.type === 'atrule' &&
            /(?:^|-)keyframes$/i.test(parent.name)
          ) {
            return;
          }
        }
        for (const selector of rule.selectors) {
          assert.ok(selector.includes('.choreo-site'), `${file}: ${selector}`);
        }
      });
    }
  }
});

test('Boxel formats keep live tiles embedded and fitted cards inert', () => {
  const source = readFileSync(join(realm, 'site.gts'), 'utf8');
  assert.match(source, /static embedded = DemoEmbedded/);
  assert.match(source, /static fitted = DemoFitted/);
  assert.match(source, /<DemoStage @id=/);
  assert.match(source, /width: min\(400px, 100%\)/);
  const fitted = source.slice(
    source.indexOf('class DemoFitted'),
    source.indexOf('export class ChoreoDemo'),
  );
  assert.doesNotMatch(fitted, /DemoStage|iframe|motion/);
});

test('heavy experiences and main-DOM exceptions are explicit and assets exist', () => {
  assert.deepEqual(manifest.iframeRoutes, ['_sylva', 'towers', 'sagrada']);
  assert.deepEqual(manifest.mainDom, ['mockup', 'long-take']);
  const iframeIndex = readFileSync(join(realm, 'iframe/index.html'), 'utf8');
  assert.match(iframeIndex, /assets\/app-[^" ]+\.mjs/);
  assert.doesNotMatch(iframeIndex, /assets\/app-[^" ]+\.js/);
  for (const path of [
    'models/iphone-15-pro.glb',
    'models/macbook-pro.glb',
    'draco/draco_wasm_wrapper.txt',
    'still/macbook.webp',
    'sylva-poster.webp',
    'asset/towers-model.html',
    'asset/towers/vo/title.mp3',
    'xstress-loop.mp4',
    'icon.svg',
    'og.png',
    'robots.txt',
    'iframe/index.html',
    'iframe/asset/towers-model.html',
    'iframe/asset/towers/vo/title.mp3',
    'iframe/asset/sagrada-model.html',
    'iframe/asset/sagrada/vo/title.mp3',
    'iframe/asset/sagrada/luts/sandstone.cube',
  ]) {
    assert.ok(existsSync(join(realm, path)), `${path} is generated`);
  }
});

test('heavy stages fetch realm HTML into sandboxed srcdoc frames', () => {
  const source = readFileSync(
    join(packageRoot, 'src/components/raw-document-frame.gts'),
    'utf8',
  );
  assert.match(source, /Accept:\s*'application\/vnd.card\+source'/);
  assert.match(source, /srcdoc=/);
  assert.match(source, /<base href=/);
  assert.match(source, /window\.__choreoPicture=/);
  assert.match(source, /allow-scripts allow-same-origin allow-pointer-lock/);
  assert.match(
    source,
    /registerDestructor\(this, \(\) => this.abort.abort\(\)\)/,
  );
  assert.doesNotMatch(source, /<iframe[^>]+src=\{\{sourceUrl\}\}/s);
});
