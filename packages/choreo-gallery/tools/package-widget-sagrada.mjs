import fs from 'node:fs';
import path from 'node:path';
const root =
  process.env.WIDGET_PACKAGE || 'out/widget-boxel-publish/iframe/gallery';
const directory = path.join(root, 'asset/sagrada');
const rewrite = (code) =>
  code.replace(
    /(['"])(\.{1,2}\/[^'"]+)\.js\1/g,
    (_, quote, name) => quote + name + '.mjs' + quote,
  );
// Boxel compiles .js realm modules; the film's vendored browser modules must be served verbatim.
for (const name of fs
  .readdirSync(directory, { recursive: true })
  .filter((n) => n.endsWith('.js'))) {
  fs.writeFileSync(
    path.join(directory, name.replace(/\.js$/, '.mjs')),
    rewrite(fs.readFileSync(path.join(directory, name), 'utf8')),
  );
}
const html = path.join(root, 'asset/sagrada-model.html');
// srcdoc has no location.search of its own; the document bridge retains the real asset URL.
fs.writeFileSync(
  html,
  rewrite(fs.readFileSync(html, 'utf8')).replaceAll(
    'location.search',
    'new URL(window.__widgetPageURL||location.href).search',
  ),
);
// Towers uses the same hosted-picture query contract.
const towers = path.join(root, 'asset/towers-model.html');
fs.writeFileSync(
  towers,
  fs
    .readFileSync(towers, 'utf8')
    .replaceAll(
      'location.search',
      'new URL(window.__widgetPageURL||location.href).search',
    ),
);
fs.copyFileSync(
  path.join(root, 'asset/towers/three-149.js'),
  path.join(root, 'asset/towers/three-149.mjs'),
);
fs.writeFileSync(
  towers,
  fs
    .readFileSync(towers, 'utf8')
    .replaceAll('towers/three-149.js', 'towers/three-149.mjs'),
);
