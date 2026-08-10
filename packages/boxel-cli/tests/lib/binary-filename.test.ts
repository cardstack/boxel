import { describe, it, expect } from 'vitest';
import { isBinaryFilename } from '@cardstack/runtime-common/infer-content-type';

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
    // text/* (including the .gts/.ts content-type overrides)
    'card.gts',
    'card.ts',
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
