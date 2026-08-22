// Glint 2 emits `foo.gts.d.ts` for `foo.gts`; rollup emits `foo.js`. package.json#exports maps
// `./foo` → `declarations/foo.d.ts`, so rename the declarations to match the JS.
import {
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    const m = name.match(/^(.*)\.g[jt]s(\.d\.ts(?:\.map)?)$/);
    if (!m) {
      continue;
    }
    const target = join(dir, m[1] + m[2]);
    if (name.endsWith('.map')) {
      writeFileSync(
        target,
        readFileSync(p, 'utf8').replace(/\.g[jt]s\.d\.ts/g, '.d.ts'),
      );
    } else {
      writeFileSync(
        target,
        readFileSync(p, 'utf8').replace(/\.g[jt]s\.d\.ts\.map/g, '.d.ts.map'),
      );
    }
    renameSync(p, p + '.tmp'); // keep rename atomic-ish; remove the original
    import('node:fs').then(({ unlinkSync }) => unlinkSync(p + '.tmp'));
  }
}
walk(new URL('../declarations', import.meta.url).pathname);
