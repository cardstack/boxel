import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Hash every file under packages/boxel-ui/addon/dist (skip source maps) so
// the realm-server can detect cross-deploy boxel-ui changes and trigger a
// full reindex of cards' prerendered HTML. Same algorithm as the prior
// webpack plugin (lib/build/package-dist-checksums.js, deleted in the
// vite migration) so an existing /persistent/boxel-ui-checksum.txt on
// EFS stays comparable across the cutover.
function calculateBoxelUIChecksum(baseDir) {
  const distPath = path.resolve(baseDir, '../boxel-ui/addon/dist');

  if (!fs.existsSync(distPath)) {
    console.warn(
      '⚠️  Boxel-UI dist directory not found. Run "pnpm build" in packages/boxel-ui/addon first.',
    );
    return null;
  }

  const allFiles = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if (!name.endsWith('.map')) {
        allFiles.push(full);
      }
    }
  };
  walk(distPath);
  allFiles.sort();

  const hash = crypto.createHash('sha256');
  for (const filePath of allFiles) {
    const relativePath = path.relative(distPath, filePath);
    const content = fs.readFileSync(filePath);
    hash.update(
      relativePath +
        ':' +
        crypto.createHash('sha256').update(content).digest('hex'),
    );
  }
  return hash.digest('hex');
}

// Vite/rollup plugin: emit boxel-ui-checksum.txt at the bundle root so
// the host serves it at <assetsURL>/boxel-ui-checksum.txt. Only runs on
// `vite build` — dev server doesn't need a static checksum, and computing
// it would just slow down `vite dev` startup.
export function boxelUIChecksumPlugin(baseDir) {
  return {
    name: 'boxel-ui-checksum',
    apply: 'build',
    generateBundle() {
      const checksum = calculateBoxelUIChecksum(baseDir);
      if (checksum) {
        this.emitFile({
          type: 'asset',
          fileName: 'boxel-ui-checksum.txt',
          source: checksum,
        });
      }
    },
  };
}

export { calculateBoxelUIChecksum };
