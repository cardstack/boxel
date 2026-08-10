import { describe, it, expect } from 'vitest';
import {
  isBinaryContentType,
  isBinaryFilename,
} from '@cardstack/runtime-common/infer-content-type';

// `isBinaryFilename` decides which wire format the CLI uses: binary paths
// move raw bytes (octet-stream upload, arrayBuffer download) while text
// paths UTF-8-decode, replacing invalid sequences with U+FFFD. Classifying
// text as binary still preserves bytes; classifying binary as text corrupts
// them — so anything not affirmatively textual must land on the binary side.
describe('isBinaryFilename', () => {
  const binary = [
    // media / fonts / documents
    'photo.jpg',
    'image.png',
    'anim.gif',
    'font.woff2',
    'legacy-font.eot',
    'doc.pdf',
    'sound.mp3',
    'sound.wav',
    // container / video / archive formats
    'archive.zip',
    'blob.bin',
    'video.mp4',
    'video.mov',
    'video.webm',
    'bundle.tar',
    'bundle.gz',
    'module.wasm',
    'report.docx',
    // unknown or missing extensions default to application/octet-stream
    'LICENSE',
    'Dockerfile',
    'data.unknownext',
  ];

  const text = [
    // text/* (including the .gts/.gjs/.ts content-type overrides). The
    // overrides matter: mime-types maps none of these three to a textual
    // type on its own — .ts resolves to video/mp2t, and .gts/.gjs to
    // nothing at all — yet all three are card module source.
    'card.gts',
    'card.gjs',
    'card.ts',
    'types.d.ts',
    'notes.md',
    'style.css',
    'page.html',
    'plain.txt',
    'data.csv',
    'config.yaml',
    // structured-syntax suffixes (+json / +xml)
    'icon.svg',
    'app.webmanifest',
    // textual application/* types
    'instance.json',
    'bundle.map',
    'script.js',
    'script.mjs',
    'script.cjs',
    'feed.xml',
    'setup.sh',
    'schema.sql',
    'settings.toml',
  ];

  for (let filename of binary) {
    it(`classifies ${filename} as binary`, () => {
      expect(isBinaryFilename(filename)).toBe(true);
    });
  }

  for (let filename of text) {
    it(`classifies ${filename} as text`, () => {
      expect(isBinaryFilename(filename)).toBe(false);
    });
  }
});

// Callers holding a response classify on the served content type instead of
// the requested name, so the two entry points must agree on the same
// taxonomy — and the content-type form has to tolerate header syntax.
describe('isBinaryContentType', () => {
  it('ignores content-type parameters', () => {
    expect(isBinaryContentType('text/plain; charset=utf-8')).toBe(false);
    expect(isBinaryContentType('application/json;charset=UTF-8')).toBe(false);
    expect(isBinaryContentType('application/octet-stream; name=x')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isBinaryContentType('TEXT/PLAIN')).toBe(false);
    expect(isBinaryContentType('Application/JSON')).toBe(false);
  });

  it('classifies every textual mime type the platform speaks as text', () => {
    // A card id resolves to its .json source, and module source is served
    // under the glimmer/typescript types. The vnd.card vendor types are
    // textual too, so no surface that echoes one can trip the byte path.
    expect(isBinaryContentType('application/json')).toBe(false);
    expect(isBinaryContentType('text/typescript+glimmer')).toBe(false);
    expect(isBinaryContentType('text/javascript+glimmer')).toBe(false);
    expect(isBinaryContentType('application/vnd.card+json')).toBe(false);
    expect(isBinaryContentType('application/vnd.card+source')).toBe(false);
    expect(isBinaryContentType('application/vnd.card+html')).toBe(false);
    expect(isBinaryContentType('application/vnd.card.file-meta+json')).toBe(
      false,
    );
    expect(isBinaryContentType('application/vnd.api+json')).toBe(false);
  });

  it('treats unrecognized and media types as binary', () => {
    expect(isBinaryContentType('application/octet-stream')).toBe(true);
    expect(isBinaryContentType('application/zip')).toBe(true);
    expect(isBinaryContentType('video/mp4')).toBe(true);
    expect(isBinaryContentType('image/png')).toBe(true);
    expect(isBinaryContentType('application/x-newly-invented')).toBe(true);
  });

  it('accepts both mime-db spellings of sql and yaml', () => {
    // These types are spelled differently across mime-db releases; a lookup
    // resolving to either spelling must land on the text side.
    for (let type of [
      'application/sql',
      'application/x-sql',
      'application/yaml',
      'application/x-yaml',
      'text/yaml',
    ]) {
      expect(isBinaryContentType(type), `${type} should be text`).toBe(false);
    }
  });
});
