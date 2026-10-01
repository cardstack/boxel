import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Uses the Boxel CLI's active profile. Never reads or stores account credentials.
const root = resolve(
  process.env.WIDGET_UPLOAD_ROOT || 'out/widget-boxel-publish',
);
const realm = process.env.BOXEL_SOURCE_REALM;
const cli = process.env.BOXEL_CLI || 'boxel';
if (!realm || !/^https?:\/\//.test(realm)) {
  throw new Error('Set BOXEL_SOURCE_REALM to your source realm URL.');
}
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) {
      throw new Error('Refusing upload of a symbolic link.');
    }
    const file = join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
// Upload entry documents last; do not delete or replace other realm paths.
const files = walk(root).sort(
  (a, b) => Number(a.endsWith('.html')) - Number(b.endsWith('.html')),
);
for (const [i, file] of files.entries()) {
  const name = relative(root, file).split('\\').join('/');
  if (!process.argv.includes('--dry-run')) {
    execFileSync(
      cli,
      ['file', 'write', name, '--realm', realm, '--file', file],
      { stdio: 'inherit' },
    );
  }
  console.log(`${i + 1}/${files.length} ${name}`);
}
console.log('Upload complete. Publish the source realm with Boxel when ready.');
