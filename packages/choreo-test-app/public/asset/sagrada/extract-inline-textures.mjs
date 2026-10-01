// One-time mechanical migration of embedded bytes to independently cached
// same-origin files. Does not change the images, material settings or score.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(here, '../sagrada-model.html');
const html = readFileSync(htmlPath, 'utf8');
const match = html.match(/const TEX=(\{[^\n]+\});/);
if (!match) {
  throw new Error('Texture table missing');
}
const old = JSON.parse(match[1]),
  next = {};
mkdirSync(resolve(here, 'textures'), { recursive: true });
let extracted = 0;
for (const [key, value] of Object.entries(old)) {
  const m = value.match(/^data:image\/(webp|png|jpeg);base64,(.+)$/);
  if (!m) {
    next[key] = value;
    continue;
  }
  const filename = key + '.' + m[1],
    bytes = Buffer.from(m[2], 'base64');
  writeFileSync(resolve(here, 'textures', filename), bytes);
  next[key] = 'sagrada/textures/' + filename;
  extracted += bytes.length;
}
const updated = html.replace(
  match[0],
  'const TEX=' + JSON.stringify(next) + ';',
);
writeFileSync(htmlPath, updated);
console.log(
  JSON.stringify({
    before: Buffer.byteLength(html),
    after: Buffer.byteLength(updated),
    extracted,
  }),
);
