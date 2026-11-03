import path from 'node:path';

export function publicSourceNamesPlugin({ sourceRoot, setting }) {
  if (setting === undefined || setting === 'false') return null;
  if (setting !== 'true' || !path.isAbsolute(sourceRoot)) {
    throw new Error(
      'Public source names require a true/false setting and an absolute source root',
    );
  }
  let root = sourceRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (!root || root === path.parse(root).root)
    throw new Error('Invalid public source root');
  return {
    name: 'boxel-public-source-names',
    apply: 'build',
    enforce: 'post',
    renderChunk(code) {
      let redacted = code
        .replaceAll(`file://${root}/`, 'boxel-source:/')
        .replaceAll(`${root}/`, '@boxel-source/');
      return redacted === code ? null : { code: redacted, map: null };
    },
  };
}
