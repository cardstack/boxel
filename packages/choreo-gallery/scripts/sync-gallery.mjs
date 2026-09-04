import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { scopeStyles } from './scope-css.mjs';
const root = resolve(import.meta.dirname, '../../..');
const pkg = resolve(import.meta.dirname, '..');
const app = join(root, 'test-app/app');
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}
function write(path, source) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}
for (const folder of ['components', 'lib']) {
  for (const path of walk(join(app, folder))) {
    const relative = path.slice(app.length + 1);
    if (relative === 'lib/theme.ts') {
      continue;
    }
    let source = readFileSync(path, 'utf8').replaceAll(
      'test-app/',
      'choreo-gallery/',
    );
    // Draco stringifies this source into a classic worker. Serving it as a
    // realm JS module rewrites fetch to import.meta.loader.fetch, which is
    // invalid inside that worker. Keep the decoder as a raw text asset.
    source = source.replace(
      'new DRACOLoader().setDecoderPath(DRACO)',
      'new DRACOLoader().setDecoderPath({ js: `${DRACO}draco_wasm_wrapper.txt`, wasm: `${DRACO}draco_decoder.wasm` })',
    );
    source = source.replace(
      "import { LinkTo } from '@ember/routing';",
      "import { LinkTo } from 'choreo-gallery/components/host-link';",
    );
    source = source
      .replace("import { pageTitle } from 'ember-page-title';", '')
      .replace(/\{\{pageTitle[^}]*\}\}/g, '');
    source = source.replace("import { service } from '@ember/service';", '');
    source = source.replace(
      /import type TheaterService from 'choreo-gallery\/services\/theater';/,
      "import { theater } from 'choreo-gallery/lib/host-navigation';",
    );
    source = source.replace(
      /import type RouterService from '@ember\/routing\/router-service';/,
      "import { router } from 'choreo-gallery/lib/host-navigation';",
    );
    source = source.replace(
      /@service declare private theater: TheaterService;/g,
      'private theater = theater;',
    );
    source = source.replace(
      /@service declare private router: RouterService;/g,
      'private router = router;',
    );
    source = source.replaceAll(
      'document.body.classList',
      "(this.mountRoot ?? document.querySelector('.choreo-site'))?.classList",
    );
    // Plain style tags are intentionally cross-component in the gallery.
    // Keep that behavior, but constrain every rule to the Boxel mount.
    if (path.endsWith('.gts')) {
      source = source.replace(
        /<style>([\s\S]*?)<\/style>/g,
        (_tag, css) => `<style>${scopeStyles(css, path)}</style>`,
      );
    }
    if (relative === 'components/demo-page.gts') {
      source = source.replace(
        'Args: { model?: DemoEntry };',
        'Args: { model?: DemoEntry; catalog?: DemoEntry[]; hrefFor?: unknown; navigate?: unknown };',
      );
      source = source.replace(
        '  get near()',
        '  private mountRoot?: Element;\n  get near()',
      );
      source = source.replace(
        'private dress = modifier((_el: Element,',
        'private dress = modifier((_el: Element,',
      );
      source = source.replace(
        "    (this.mountRoot ?? document.querySelector('.choreo-site'))?.classList.toggle",
        "    this.mountRoot = _el.closest('.choreo-site') ?? undefined;\n    (this.mountRoot ?? document.querySelector('.choreo-site'))?.classList.toggle",
      );
    } else {
      source = source.replaceAll(
        "(this.mountRoot ?? document.querySelector('.choreo-site'))",
        "document.querySelector('.choreo-site')",
      );
    }
    if (relative === 'components/gallery.gts') {
      source = source.replace(
        'export class Gallery extends Component {',
        'export class Gallery extends Component<{ Args: { catalog?: unknown; hrefFor?: unknown; navigate?: unknown } }> {',
      );
    }
    if (relative === 'lib/catalog.ts') {
      source = source.replace(
        "id: 'sylva',",
        "id: 'sylva',\n    theater: true,",
      );
      source +=
        '\nexport type SpecialStages = Record<string, DemoEntry["Example"]>;\nexport function createCatalog(_stages?: SpecialStages) { return catalog; }\n';
    }
    if (
      [
        'components/tower-stage.gts',
        'components/sagrada-stage.gts',
        'components/sylva-stage.gts',
      ].includes(relative)
    ) {
      source =
        "import { RawDocumentFrame } from 'choreo-gallery/components/raw-document-frame';\n" +
        source;
      const route = relative.includes('tower-stage')
        ? 'towers'
        : relative.includes('sagrada-stage')
          ? 'sagrada'
          : '_sylva';
      source = source.replace(
        /<iframe([\s\S]*?)><\/iframe>/g,
        (_, attrs) =>
          `<RawDocumentFrame @route="${route}" ${attrs
            .replace(/src=\{\{[^}]+\}\}/g, '')
            .replace(/title="([^"]+)"/g, '@title="$1"')
            .replace(/sandbox="[^"]*"/g, '')} />`,
      );
    }
    write(join(pkg, 'src', relative), source);
  }
}
let crossing = readFileSync(join(pkg, 'src/lib/crossing.ts'), 'utf8');
crossing += `\nexport function beginNavigation(from: string | null, to: string | null) {\n  beginCrossing({ from: { name: from ? 'demo' : 'index', params: { demo_id: from } }, to: { name: to ? 'demo' : 'index', params: { demo_id: to } } } as never);\n}\n`;
write(join(pkg, 'src/lib/crossing.ts'), crossing);
write(
  join(pkg, 'styles/app.css'),
  readFileSync(join(app, 'styles/app.css'), 'utf8'),
);
cpSync(join(root, 'test-app/public'), join(pkg, 'public'), { recursive: true });
console.log('Synced the current test-app gallery sources and media for Boxel.');
