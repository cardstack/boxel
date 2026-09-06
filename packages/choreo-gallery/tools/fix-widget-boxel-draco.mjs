import fs from 'node:fs';
const root =
  process.env.WIDGET_PACKAGE || 'out/widget-boxel-publish/iframe/gallery';
for (const name of ['draco_wasm_wrapper', 'draco_decoder']) {
  fs.copyFileSync(
    `test-app/public/draco/${name}.js`,
    `${root}/draco/${name}.mjs`,
  );
}
for (const file of fs
  .readdirSync(`${root}/assets`)
  .filter((p) => p.startsWith('DRACOLoader-') && p.endsWith('.mjs'))) {
  const path = `${root}/assets/${file}`;
  fs.writeFileSync(
    path,
    fs
      .readFileSync(path, 'utf8')
      .replaceAll('draco_wasm_wrapper.js', 'draco_wasm_wrapper.mjs')
      .replaceAll('draco_decoder.js', 'draco_decoder.mjs'),
  );
}
