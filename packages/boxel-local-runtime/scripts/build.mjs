import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
await mkdir('dist', { recursive: true });
for (const filename of await readdir('src')) {
  if (!filename.endsWith('.ts') || filename.endsWith('.d.ts')) continue;
  const source = stripTypeScriptTypes(
    await readFile(`src/${filename}`, 'utf8'),
    { mode: 'transform', sourceUrl: `src/${filename}` },
  );
  await writeFile(
    `dist/${filename.replace(/\.ts$/, '.js')}`,
    source.replace(/(['"])\.\/([^'"]+)\.ts\1/g, '$1./$2.js$1'),
  );
}

const contracts = await readFile('src/contracts.ts', 'utf8');
const api = (await readFile('src/public-api.d.ts', 'utf8'))
  .replace(/^export type \* from [^;]+;\s*/gm, '')
  .replace(/import type\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];\s*/gs, '');
await writeFile(
  'dist/index.d.ts',
  '// Generated from the Boxel monorepo native contract.\n' +
    contracts +
    '\n' +
    api,
);
await writeFile(
  'dist/desktop-profiles.d.ts',
  await readFile('src/desktop-profiles-api.d.ts', 'utf8'),
);
