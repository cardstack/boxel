/**
 * The complete persisted FileTwin fixture matrix.
 *
 * These are real cards from the filedef-format-research staging realm. They
 * intentionally share one card type while varying the resource, renderer,
 * browser API, library graph, and lifecycle state behind it. Staging is the
 * behavioral reference; a staging-backed Host is the candidate.
 */
const referenceOrigin = 'https://realms-staging.stack.cards';
const defaultCandidateOrigin = 'https://host.codex-execution-runtime.localhost';
const realmPath = '/ctse/filedef-format-research';
const sourceUrl = `${referenceOrigin}${realmPath}/file-twin.gts`;

const twins = [
  twin('ada-lovelace', 'ada-lovelace.json', 'data', 'normal', 'JSON card'),
  twin(
    'annual-report-2025',
    'annual-report-2025.pdf',
    'pdf',
    'normal',
    'PDF canvas and paging',
    { requiredSelectors: ['canvas'] },
  ),
  twin('brand-kit', 'brand-kit.zip', 'archive', 'normal', 'ZIP manifest'),
  twin('cardstack-mark', 'cardstack-mark.svg', 'image', 'normal', 'SVG image', {
    minimumHealthyImages: 1,
    requiredSelectors: ['img'],
  }),
  twin(
    'chair-lounge',
    'chair-lounge.glb',
    'model',
    'normal',
    'Three.js GLB canvas and orbit controls',
    { requiredSelectors: ['canvas'] },
  ),
  twin('contact-card-ts', 'contact-card.ts', 'code', 'normal', 'TypeScript'),
  twin('contract-v4', 'contract-v4.docx', 'office', 'normal', 'DOCX'),
  twin(
    'ep-114-systems',
    'ep-114-systems.mp3',
    'audio',
    'normal',
    'catalog waveform and native audio',
    { requiredSelectors: ['audio'] },
  ),
  twin('firmware-v3', 'firmware-v3.bin', 'generic', 'normal', 'binary'),
  twin(
    'harbor-at-dawn',
    'harbor-at-dawn.jpg',
    'image',
    'normal',
    'JPEG image',
    { minimumHealthyImages: 1, requiredSelectors: ['img'] },
  ),
  twin('kickoff-deck', 'kickoff-deck.pptx', 'office', 'normal', 'PPTX'),
  twin('launch-brief', 'launch-brief.md', 'document', 'normal', 'Markdown'),
  twin('loading-loop', 'loading-loop.gif', 'image', 'normal', 'animated GIF', {
    minimumHealthyImages: 1,
    requiredSelectors: ['img'],
  }),
  twin(
    'master-take-3',
    'master-take-3.m4a',
    'audio',
    'normal',
    'catalog waveform and native audio',
    { requiredSelectors: ['audio'] },
  ),
  twin('model-2026', 'model-2026.xlsx', 'office', 'normal', 'workbook grid', {
    requiredSelectors: ['table'],
  }),
  twin(
    'plexsans-variable',
    'PlexSans-Variable.woff2',
    'font',
    'normal',
    'FontFace and variable-font axes',
  ),
  twin(
    'product-tour-v2',
    'product-tour-v2.mp4',
    'video',
    'normal',
    'native video',
    { requiredSelectors: ['video'] },
  ),
  twin('profile-gts', 'profile.gts', 'code', 'normal', 'Glimmer TypeScript'),
  twin('q4-revenue', 'q4-revenue.csv', 'data', 'normal', 'CSV grid', {
    requiredSelectors: ['table'],
  }),
  twin(
    'realm-manifest',
    'realm-manifest.json',
    'data',
    'normal',
    'JSON document',
  ),
  twin(
    'state-empty-placeholder',
    'placeholder.txt',
    'document',
    'empty',
    'empty-state presentation',
  ),
  twin(
    'state-failed-chair',
    'chair-lounge.glb',
    'model',
    'failed',
    'failed-resource presentation',
  ),
  twin(
    'state-generating-product-tour',
    'product-tour-v2.mp4',
    'video',
    'generating',
    'generating-state presentation',
  ),
  twin(
    'state-malformed-export',
    'export-broken.csv',
    'data',
    'malformed',
    'malformed CSV recovery',
    { requiredSelectors: ['table'] },
  ),
  twin(
    'state-queued-annual-report',
    'annual-report-2025.pdf',
    'pdf',
    'loading',
    'queued-state presentation',
  ),
  twin(
    'state-stale-hero-banner',
    'hero-banner.jpg',
    'image',
    'stale',
    'stale-image presentation',
    { minimumHealthyImages: 1, requiredSelectors: ['img'] },
  ),
  twin(
    'state-unsupported-img2231',
    'IMG_2231.heic',
    'generic',
    'unsupported',
    'unsupported-format presentation',
  ),
];

export const executionRuntimeFileTwinUrlMatrix = twins.map((entry) => {
  let path = `${realmPath}/fixtures/${entry.id}`;
  return {
    ...entry,
    candidateUrl: `${defaultCandidateOrigin}${path}`,
    referenceUrl: `${referenceOrigin}${path}`,
    sourceUrl,
  };
});

export const executionRuntimeFileTwinCases =
  executionRuntimeFileTwinUrlMatrix.map((entry) => ({
    ...entry,
    expectedExecution: 'sandbox',
    mustContain: [entry.fileName],
    path: new URL(entry.referenceUrl).pathname,
    referenceParity: true,
  }));

/**
 * Live FileDef adapters exercise the actual staging relationships and
 * resource URLs. Keep these separate from the immutable 27-twin inventory:
 * the twins prove the renderer cross-product, while this lane proves that the
 * same renderers can obtain real private bytes through the Sandbox boundary.
 *
 * The browser runner visits these sequentially. Only MIDI starts playback;
 * audio and video cases assert that their native element became ready without
 * simultaneously consuming multiple media resources.
 */
export const executionRuntimeLiveFileCases = [
  liveFileCase(
    'live-annual-report-2025',
    'annual-report-2025.pdf',
    ['1 / 24'],
    'authenticated scalar resourceUrl, PDF bytes, and canvas rendering',
    { requiredSelectors: ['canvas'] },
  ),
  liveFileCase(
    'live-brand-kit',
    'brand-kit.zip',
    ['brand-kit/colors.json', 'brand-kit/type-scale.json'],
    'authenticated scalar resourceUrl and archive entry projection',
  ),
  liveFileCase(
    'live-cardstack-mark',
    'cardstack-mark.svg',
    ['SVG vector'],
    'linked SVG FileDef image delivery',
    { minimumHealthyImages: 1, requiredSelectors: ['img'] },
  ),
  liveFileCase(
    'live-chair-lounge',
    'chair-lounge.glb',
    ['Drag to orbit', '3072'],
    'authenticated scalar resourceUrl, GLB parsing, and interactive canvas',
    { requiredSelectors: ['canvas'] },
  ),
  liveFileCase(
    'live-contact-card',
    'contact-card.ts',
    ['vCard 4.0'],
    'linked TypeScript source projection',
  ),
  liveFileCase(
    'live-ep-114-systems',
    'ep-114-systems.mp3',
    ['MP3 audio'],
    'authenticated scalar resourceUrl and native MP3 readiness',
    { requiredSelectors: ['audio'] },
  ),
  liveFileCase(
    'live-firmware-v3',
    'firmware-v3.bin',
    ['No preview', 'FALLBACK'],
    'authenticated scalar resourceUrl with a deliberate binary fallback',
  ),
  liveFileCase(
    'live-harbor-at-dawn',
    'harbor-at-dawn.jpg',
    ['JPEG image'],
    'linked JPEG FileDef image delivery',
    { minimumHealthyImages: 1, requiredSelectors: ['img'] },
  ),
  liveFileCase(
    'live-launch-brief',
    'launch-brief.md',
    ['Launch Brief — Q3 Portal Release'],
    'linked Markdown source projection',
  ),
  liveFileCase(
    'live-loading-loop',
    'loading-loop.gif',
    ['GIF image'],
    'linked animated GIF FileDef image delivery',
    { minimumHealthyImages: 1, requiredSelectors: ['img'] },
  ),
  liveFileCase(
    'live-master-take-3',
    'master-take-3.m4a',
    ['M4A audio', '0:15'],
    'authenticated scalar resourceUrl and native M4A readiness',
    { requiredSelectors: ['audio'] },
  ),
  {
    id: 'live-midi-prelude',
    path: `${realmPath}/live/live-midi-prelude`,
    expectedExecution: 'sandbox',
    mustContain: [
      'beethoven-egmont-overture.mid',
      '14 tracks',
      '10681 notes',
      '7:59',
    ],
    interaction: {
      kind: 'media-play',
      playName: 'Play MIDI sequence',
      pauseName: 'Pause MIDI sequence',
      requireProgress: true,
    },
    purpose:
      'authenticated resourceUrl projection, MIDI parsing, Web Audio unlock, and a live playback clock',
    referenceParity: true,
  },
  liveFileCase(
    'live-placeholder',
    'placeholder.txt',
    ['Release handoff — File Workspace'],
    'linked plain-text source projection',
  ),
  liveFileCase(
    'live-product-tour-v2',
    'product-tour-v2.mp4',
    ['MP4 video', '0:05'],
    'authenticated scalar resourceUrl and native video readiness',
    { requiredSelectors: ['video'] },
  ),
  liveFileCase(
    'live-profile',
    'profile.gts',
    ['SCHEMA · PROFILE', 'displayHandle'],
    'linked GTS source and schema projection',
  ),
  liveFileCase(
    'live-q4-revenue',
    'q4-revenue.csv',
    ['Showing 8 of 1,204 rows', 'margin_pct'],
    'linked CSV source and structured-data surface handoff',
    { requiredSelectors: ['[role="grid"]'] },
  ),
  liveFileCase(
    'live-realm-manifest',
    'realm-manifest.json',
    ['filedef-format-research', '0.4.0'],
    'linked JSON source projection',
  ),
];

export const executionRuntimeFileResearchCases = [
  ...executionRuntimeFileTwinCases,
  ...executionRuntimeLiveFileCases,
];

validateFileTwinCorpus(executionRuntimeFileTwinCases);

function twin(id, fileName, family, state, purpose, options = {}) {
  return {
    family,
    fileName,
    id,
    minimumHealthyImages: 0,
    purpose,
    requiredSelectors: [],
    state,
    ...options,
  };
}

function liveFileCase(id, fileName, mustContain, purpose, options = {}) {
  return {
    id,
    path: `${realmPath}/live/${id}`,
    expectedExecution: 'sandbox',
    mustContain: [fileName, ...mustContain],
    purpose,
    referenceParity: true,
    ...options,
  };
}

export function validateFileTwinCorpus(cases) {
  if (cases.length !== 27) {
    throw new Error(
      `The FileTwin compatibility lane must contain all 27 twins; found ${cases.length}`,
    );
  }

  let ids = new Set();
  let paths = new Set();
  let states = new Set();
  for (let smokeCase of cases) {
    if (!smokeCase.id || ids.has(smokeCase.id)) {
      throw new Error(`FileTwin id must be unique: ${smokeCase.id}`);
    }
    if (
      !smokeCase.path?.startsWith(`${realmPath}/fixtures/`) ||
      paths.has(smokeCase.path)
    ) {
      throw new Error(
        `FileTwin path must be a unique persisted fixture: ${smokeCase.path}`,
      );
    }
    if (
      !smokeCase.family ||
      !smokeCase.fileName ||
      !smokeCase.purpose ||
      smokeCase.referenceParity !== true ||
      smokeCase.expectedExecution !== 'sandbox'
    ) {
      throw new Error(
        `FileTwin ${smokeCase.id} must declare its file semantics and Sandbox parity contract`,
      );
    }
    ids.add(smokeCase.id);
    paths.add(smokeCase.path);
    states.add(smokeCase.state);
  }

  for (let requiredState of [
    'normal',
    'empty',
    'failed',
    'generating',
    'malformed',
    'loading',
    'stale',
    'unsupported',
  ]) {
    if (!states.has(requiredState)) {
      throw new Error(`FileTwin corpus is missing state: ${requiredState}`);
    }
  }
}
