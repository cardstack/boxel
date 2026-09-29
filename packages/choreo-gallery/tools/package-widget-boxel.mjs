import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
const source = process.env.WIDGET_BUILD || 'out/widget-boxel-build',
  out = process.env.WIDGET_PACKAGE || 'out/widget-boxel-publish/iframe/gallery';
mkdirSync(join(out, 'assets'), { recursive: true });
// Include narration, fonts, posters, models and every public demo dependency.
cpSync('test-app/public', out, { recursive: true });
const modules = readdirSync(join(source, 'assets')).filter((n) =>
  n.endsWith('.js'),
);
const rewrite = (s) =>
  modules.reduce(
    (text, n) => text.replaceAll(n, n.replace(/\.js$/, '.mjs')),
    s,
  );
for (const name of readdirSync(join(source, 'assets'))) {
  if (name.endsWith('.js')) {
    let code = rewrite(readFileSync(join(source, 'assets', name), 'utf8'))
      .replaceAll(
        'window.location.href',
        '(window.__widgetPageURL||window.location.href)',
      )
      .replaceAll(
        'window.location.search',
        'new URL(window.__widgetPageURL||window.location.href).search',
      );
    // The standalone room uses hash routes, including the nested Sylva theater.
    code = code.replace(
      /`\$\{([^}]+)\.rootURL\}_sylva\?embed`/g,
      '`${window.location.href.split("#")[0]}#/_sylva?embed`',
    );
    writeFileSync(join(out, 'assets', name.replace(/\.js$/, '.mjs')), code);
  } else {
    cpSync(join(source, 'assets', name), join(out, 'assets', name));
  }
}
cpSync(join(source, '@embroider/virtual/app.css'), join(out, 'widget-app.css'));
cpSync(
  join(source, '@embroider/virtual/vendor.js'),
  join(out, 'widget-vendor.mjs'),
);
cpSync('test-app/public/widget-room.css', join(out, 'widget-room.css'));
cpSync('test-app/public/widget-previews', join(out, 'widget-previews'), {
  recursive: true,
});
let html = rewrite(readFileSync(join(source, 'index.html'), 'utf8'))
  .replace('./@embroider/virtual/app.css', './widget-app.css')
  .replace('./@embroider/virtual/vendor.js', './widget-vendor.mjs');
html = html.replace(
  /(name="test-app\/config\/environment" content=")([^"]+)/,
  (_, prefix, encoded) => {
    const cfg = JSON.parse(decodeURIComponent(encoded));
    cfg.rootURL = './';
    return prefix + encodeURIComponent(JSON.stringify(cfg));
  },
);
html = html.replace(
  '<title>glimmer-motion</title>',
  '<title>Choreo — Motion, at home.</title>',
);
html = html.replace(
  '<head>',
  '<head><meta name="robots" content="noindex,nofollow,noarchive"><script>if(!location.hash)location.replace(location.pathname+location.search+"#/_widgets");</script>',
);
html = html.replace(
  '<head>',
  '<head><script>' +
    readFileSync('scripts/widget-boxel-bridge.js', 'utf8').replaceAll(
      '</script>',
      '<\\/script>',
    ) +
    '</script>',
);
writeFileSync(join(out, 'widget-room.html'), html);
console.log(
  'Packaged the room without replacing the existing gallery entrypoint.',
);
// Keep the standalone Sagrada document compatible with Boxel's srcdoc bridge.
process.env.WIDGET_PACKAGE = out;
await import('./package-widget-sagrada.mjs');

await import('./fix-widget-boxel-draco.mjs');
