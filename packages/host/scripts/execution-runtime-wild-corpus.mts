/**
 * Fifty persisted CTSE cards forming the URL-first compatibility lane.
 *
 * This is a matrix of real card URLs, not synthetic GTS test modules: cards
 * ordinary workspaces already hold, each chosen for a distinct execution
 * behavior. Every row's `adoptsFrom` resolves to a current, non-history module
 * or to trusted Base. The deployed staging Host is the reference; a
 * staging-backed local Host is the candidate.
 *
 * The corpus validates; it does not drive. A red card here opens a conformance
 * test against the rendering protocol; the fix lands against that test, never
 * as a card-specific exception in an adapter.
 *
 * This file is the executable source of truth. `docs/boxel-execution-runtime-wild-corpus.md`
 * and the browser smoke runner consume the same list, so the doc and the
 * automated input cannot diverge.
 *
 * `candidateOrigin` is centralized here. A local Host on a different port is
 * one edit; the 50 card paths are unaffected.
 */
const referenceOrigin = 'https://realms-staging.stack.cards';
const candidateOrigin = 'https://localhost:4200';

export const executionRuntimeWildUrlMatrix = [
  // Format delegation, rich content, FileDef, and browser transitions.
  row(
    'format-preview-news',
    'formats',
    'electoral-rooster',
    'FormatPreview/news-preview',
    'format-preview.gts',
    'Format Preview',
    'all card formats delegated through one real preview card',
  ),
  row(
    'view-transitions',
    'formats',
    'ivory-foreshore',
    'ViewTransitionsDemo/0aeb0691-fdc5-4270-8974-e21fa6a3fbbf',
    'view-transitions-demo.gts',
    'View Transitions Demo',
    'view-transition groups, animation state, and authored CSS',
  ),
  row(
    'filedef-design-board',
    'formats',
    'filedef-format-research',
    'design-board',
    'filedef-design-board.gts',
    'FileDef Design Board',
    'FileDef rendering, embedded files, and a design-board composition',
  ),
  row(
    'filedef-embedding-guide',
    'formats',
    'filedef-format-research',
    'file-embedding-field-guide',
    'file-embedding-field-guide.gts',
    'Embedded File Field Guide',
    'nested file fields and embedded-file projection',
  ),
  row(
    'filedef-audio',
    'media',
    'filedef-format-research',
    'live/live-master-take-3',
    'live-audio-file.gts',
    'Live Audio File',
    'audio FileDef loading and media controls',
  ),
  row(
    'rich-markdown',
    'rich-content',
    'integral-wolverine',
    'RichMarkdown/63218668-c5d3-4d0d-985e-8f8214e01cb9',
    'rich-markdown.gts',
    'RichMarkdown Feature Showcase',
    'rich markdown, Mermaid, links, images, and edit projection',
  ),
  row(
    'rich-document',
    'rich-content',
    'full-meerkat',
    'RichDocument/showcase',
    'rich-document.gts',
    'Rich Document Field',
    'rich document layout, nested blocks, and code-backed content',
  ),
  row(
    'embedded-rich-markdown',
    'rich-content',
    'striped-firefly',
    'EmbeddedFieldRichMarkdown/082a18e7-5158-480f-a9b5-ba85a1db7c2a',
    'AgentNotebook/rich-markdown-field-embedded.gts',
    'Embedded Field Rich Markdown',
    'embedded markdown crossing nested component and field boundaries',
  ),

  // Clinical, policy-shaped, and school dashboard graphs.
  row(
    'clinical-study-site',
    'clinical',
    'middle-wolverine',
    'Clinical/StudySite/stdy-301-site-001-onpace',
    'Clinical/study-site.gts',
    'STDY-301',
    'clinical relationships, BXL/computeVia output, and themed status',
  ),
  row(
    'hospital-operations',
    'clinical',
    'working-loon',
    'Hospital/HospitalOperations/st-aurelius-medical-center',
    'Hospital/hospital-operations.gts',
    'St. Aurelius Medical Center',
    'hospital dashboard composition over patients and staff',
  ),
  row(
    'hospital-patient',
    'clinical',
    'working-loon',
    'Hospital/HospitalPatient/sun-li-park',
    'Hospital/hospital-patient.gts',
    'Sun-Li Park',
    'nested clinical values, medication lists, and patient presentation',
  ),
  row(
    'hospital-staff',
    'clinical',
    'working-loon',
    'Hospital/HospitalStaff/dr-amara-osei',
    'Hospital/hospital-staff.gts',
    'Dr. Amara Osei',
    'staff fields, enums, dates, and relationship projection',
  ),
  row(
    'bpm-architecture-thesis',
    'rich-content',
    'bpm-architecture',
    'ArchitectureDoc/01-thesis',
    'architecture-doc.gts',
    'BPM is npm for Boxel’s ESM world',
    'real-world rich architecture document with a table, typography, and authored Capsule presentation',
  ),
  row(
    'classroom-workflow',
    'tribeca-prep',
    'voluntary-llama',
    'ClassroomWorkflowDashboard/classroom-2a',
    'classroom-workflow-dashboard.gts',
    'Classroom Workflow Dashboard',
    'classroom workflow, lists, controls, and dense status UI',
  ),
  row(
    'head-of-school-dashboard',
    'tribeca-prep',
    'early-swift',
    'HeadOfSchoolDashboardMockup/main',
    'head-of-school-dashboard-mockup.gts',
    'Head of School Dashboard',
    'school-wide dashboard composition and responsive layout',
  ),
  row(
    'hero-classroom-dashboard',
    'tribeca-prep',
    'early-swift',
    'HeroClassroomDashboardMockup/main',
    'hero-classroom-dashboard-mockup.gts',
    'Hero Classroom Dashboard',
    'classroom hero dashboard, cards, controls, and images',
  ),
  row(
    'daily-briefing-dashboard',
    'dashboards',
    'proper-cuckoo',
    'Dashboard/daily-briefing',
    'gstack-dashboard.gts',
    'Daily Briefing',
    'production dashboard composed from boards and report data',
  ),

  // Browser-only 3D and music/audio programs.
  row(
    'tribeca-sign-maker',
    '3d',
    'coherent-crocodile',
    'tribeca-prep-sign',
    'tribeca-sign-maker.gts',
    'Tribeca Prep Sign Maker',
    'Three.js/3MF, canvas, browser APIs, and intrinsic height',
  ),
  row(
    'tribeca-logo-cube',
    '3d',
    'coherent-crocodile',
    'logo-cube-maker',
    'logo-cube-maker.gts',
    'Tribeca N Logo Matchbox',
    '3D source card with editable parameters and media output',
  ),
  row(
    'gltf-chair',
    '3d',
    'nova-enclave',
    '3-d-model-viewer-cb85e6c3-8e70-4b5e-8ceb-bc8b6cee20fd/3d-model-viewer/GltfViewer/modern-chair',
    '3-d-model-viewer-cb85e6c3-8e70-4b5e-8ceb-bc8b6cee20fd/3d-model-viewer/gltf-viewer.gts',
    'GLTF Settings',
    'nested imported GLTF viewer and allocated canvas rendering',
  ),
  row(
    'gltf-viewer',
    '3d',
    'frostbay-haven',
    'GltfViewer/9e6492ee-343b-492a-8745-a7ee4bddd677',
    '3d-model.gts',
    'GLTF Settings',
    'a second independent GLTF implementation and asset path',
  ),
  row(
    'live-music-coder',
    'music',
    'frostbay-haven',
    'LiveMusicCoder/b294e0bc-c042-4dab-b477-37a3a4fb1557',
    'live-music-coder.gts',
    'Live Music Coder',
    'live audio graph, editor state, and playback interaction',
  ),
  row(
    'music-coder',
    'music',
    'frostbay-haven',
    'MusicCoder/e3e86660-a2be-4b5d-bcd0-b294e0bcc042',
    'music-coder.gts',
    'Music Coder',
    'music composition state and browser audio APIs',
  ),
  row(
    'kpop-musical',
    'music',
    'personal',
    'KPopDemonHunterMusical/c797808d-15eb-4a8c-bd7a-0f61dbbac88c',
    'kpop-demon-hunter-musical.gts',
    'KPop Demon Hunter Musical',
    'nested cast and musical-number composition',
  ),
  row(
    'music-library',
    'music',
    'persistent-possum',
    'MusicLibraryMockup/demo',
    'mockup-music-library.gts',
    'Studio music library',
    'surface-based library, player layout, selection, and scrolling',
  ),

  // Query, long-running state, interaction, and writable standard fields.
  row(
    'assistant-recipe-gallery',
    'queries',
    'assistant-realm-runner-poc',
    'RecipeGallery/home',
    'recipe-gallery.gts',
    'Recipe Gallery',
    'query-backed gallery and linked recipe cards',
  ),
  row(
    'assistant-run',
    'async',
    'assistant-realm-runner-poc',
    'AssistantRun/5b0c9ccb-80a7-40ba-a869-7212e25345a9',
    'run.gts',
    'Immutable preview receipt',
    'Host-tool imports, progress, and long-running assistant state',
  ),
  row(
    'surface-keyboard-navigation',
    'interaction',
    'persistent-possum',
    'KeyboardSurfaceNavigation/demo',
    'keyboard-surface-navigation.gts',
    'Airline keyboard navigation',
    'focus ladder, keyboard traversal, and selection',
  ),
  row(
    'surface-combinatorial',
    'composition',
    'persistent-possum',
    'CombinatorialWorkspace/demo',
    'combinatorial-workspace.gts',
    'Release command workspace',
    'many recursively nested surface types and stable paths',
  ),
  row(
    'tier-fast-food',
    'interaction',
    'tier-maker',
    'TierList/national-fast-food-ranking',
    'tier-list.gts',
    'National Fast Food Joints',
    'drag/drop ranking, twenty private images, and edit-return continuity',
    20,
  ),
  row(
    'coffee-shop-dashboard',
    'queries',
    'mythic-alcove',
    'coffee-shop/CoffeeShopDashboard/main-dashboard',
    'coffee-shop/dashboard.gts',
    'Coffee Shop Dashboard',
    'query/list results, orders, customers, menu items, and actions',
  ),
  row(
    'airline-international',
    'computed',
    'middle-wolverine',
    'Airline/AirlineFlight/aa4500-ord-lhr',
    'Airline/airline-flight.gts',
    'AA4500',
    'deep linked computeVia/BXL graph, currency, percentages, and theme',
  ),
  row(
    'invoice-billing',
    'forms',
    'software-periodic-workspace',
    'InvoiceBillingForm/inv-2081',
    'forms/invoice-billing.gts',
    'Invoice Billing Form',
    'nested Base fields, configuration, currency, validation, and writes',
  ),
  row(
    'deal-intake',
    'forms',
    'software-periodic-workspace',
    'DealIntakeForm/daybreak-wholesale',
    'forms/deal-intake.gts',
    'Deal Intake Form',
    'writable form, validation, enum, currency, and relationships',
  ),
  row(
    'currency-field-demo',
    'base-fields',
    'software-periodic-workspace',
    'CurrencyDemo/041-currency',
    'properties/currency.gts',
    'Currency',
    'compound Base CurrencyField projection and formatting',
  ),
  row(
    'enum-field-demo',
    'base-fields',
    'software-periodic-workspace',
    'EnumDemo/049-enum',
    'properties/enum.gts',
    'Enum',
    'Base enum and FieldConfiguration semantics',
  ),

  // Surface, spreadsheet, dashboard, theme, and trusted component composition.
  row(
    'surface-canvas-board',
    'surfaces',
    'persistent-possum',
    'CanvasBoard/scratch',
    'canvas-board.gts',
    'Canvas Board',
    'pan/zoom, positioned nodes, edges, and pointer interaction',
  ),
  row(
    'surface-basic-layout',
    'surfaces',
    'persistent-possum',
    'BasicLayout/airline',
    'basic-layout.gts',
    'Airline booking workspace',
    'deep surface layout/grid/flow composition',
  ),
  row(
    'surface-spreadsheet',
    'surfaces',
    'persistent-possum',
    'SpreadsheetMockup/demo',
    'mockup-spreadsheet.gts',
    'Launch readiness spreadsheet',
    'surface grid cells, structured values, and keyboard navigation',
  ),
  row(
    'poster-board',
    'surfaces',
    'loyal-chicken',
    'PosterBoardDemo/demo',
    'poster-board-demo.gts',
    'Poster Board Demo',
    'poster board frames, x/y/w/h layout, and pointer interaction',
  ),
  row(
    'spreadsheet',
    'spreadsheets',
    'disturbing-cephalopod',
    'Spreadsheet/sample-quarterly-sales',
    'spreadsheet.gts',
    'Spreadsheet',
    'full spreadsheet model, editing, formulas, grouping, and scrolling',
  ),
  row(
    'northwind-dashboard',
    'dashboards',
    'annual-cicada',
    'NorthwindDashboard/main',
    'northwind-dashboard.gts',
    'Northwind Dashboard',
    'large business dashboard, queries, charts, and responsive CSS',
  ),
  row(
    'sales-dashboard',
    'dashboards',
    'petal-promenade',
    'SalesDashboard/my-dashboard',
    'sales-dashboard.gts',
    'Sales Dashboard',
    'lead/contact relationships, metrics, and nested dashboard sections',
  ),
  row(
    'analytics-dashboard',
    'dashboards',
    'full-meerkat',
    'SampleCard/AnalyticsDashboard/monthly-revenue',
    'SampleCard/analytics-dashboard.gts',
    'Annual Ad Revenue Dashboard',
    'charts, metrics, responsive CSS, and inherited sample cards',
  ),
  row(
    'integrated-layer-atlas',
    'dense-layout',
    'software-periodic-workspace',
    'IntegratedLayerAtlas/home',
    'integrated-layer-atlas.gts',
    'Integrated Software Layer Matrix',
    'wide matrix, grouped rows, nested fields, and theme',
  ),
  row(
    'operations-grid',
    'dense-layout',
    'software-periodic-workspace',
    'GridDemo/operations-grid',
    'interfaces/grid.gts',
    'Grid Component Demo',
    'dense table/grid presentation and repeated field cells',
  ),
  row(
    'joinery-brand-guide',
    'theme',
    'north-branch-joinery',
    'BrandGuide/north-branch-brand-guide',
    'https://cardstack.com/base/brand-guide',
    'North Branch Joinery — Brand Guide',
    'trusted Base BrandGuide, cardInfo theme, and image-rich presentation',
  ),
  row(
    'joinery-home',
    'theme',
    'north-branch-joinery',
    'north-branch-home',
    'north-branch-home.gts',
    'North Branch Joinery',
    'workspace-scale composition over an image and relationship graph',
  ),
  row(
    'card-frame-catalog',
    'trusted-components',
    'prepared-asp',
    'CardFrameDesignSystem/catalog',
    'card-frame-design-system.gts',
    'CardFrame Design System',
    'trusted CardFrame components and dense nested examples',
  ),
  row(
    'adorn-showcase',
    'trusted-components',
    'prepared-asp',
    'AdornExamples/showcase',
    'adorn-examples.gts',
    'Adorn Examples',
    'trusted layout/adornment components and nested presentation',
    51,
  ),
];

export const executionRuntimeWildCorpusCases =
  executionRuntimeWildUrlMatrix.map((entry) => ({
    ...entry,
    expectedExecution: 'discover',
    minimumHealthyImages: entry.minimumHealthyImages ?? 0,
    mustContain: [entry.signature],
    path: new URL(entry.referenceUrl).pathname,
    referenceParity: true,
  }));

validateWildCorpus(executionRuntimeWildCorpusCases);

function row(
  id,
  category,
  realm,
  cardPath,
  sourceModule,
  signature,
  purpose,
  minimumHealthyImages = 0,
) {
  let path = `/ctse/${realm}/${cardPath}`;
  let sourceUrl = sourceModule.startsWith('https://')
    ? sourceModule
    : `${referenceOrigin}/ctse/${realm}/${sourceModule}`;

  return {
    candidateUrl: `${candidateOrigin}${path}`,
    category,
    id,
    minimumHealthyImages,
    purpose,
    referenceUrl: `${referenceOrigin}${path}`,
    signature,
    sourceUrl,
  };
}

export const wildCorpusOrigins = { candidateOrigin, referenceOrigin };

export const wildCorpusDocPath = 'docs/boxel-execution-runtime-wild-corpus.md';
export const wildCorpusTableBegin = '<!-- wild-corpus:begin -->';
export const wildCorpusTableEnd = '<!-- wild-corpus:end -->';

/**
 * Render the matrix as the markdown table the doc carries.
 *
 * The doc and the runner read one list. Paths are rendered rather than whole
 * URLs because both origins are stated once above the table, and a two-column
 * URL table is unreadable at fifty rows.
 */
export function renderWildCorpusTable(cases = executionRuntimeWildCorpusCases) {
  let columns = ['#', 'Area', 'Case', 'Card path', 'What it exercises'];
  let rows = cases.map((smokeCase, index) => [
    String(index + 1),
    smokeCase.category,
    `\`${smokeCase.id}\``,
    `\`${smokeCase.path}\``,
    smokeCase.purpose,
  ]);
  let widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index].length)),
  );
  let line = (cells) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(' | ')} |`;
  let alignment = widths.map((width, index) =>
    index === 0 ? `${'-'.repeat(width - 1)}:` : '-'.repeat(width),
  );

  return [
    line(columns),
    `| ${alignment.join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
}

/**
 * Read the doc's generated table back as rows.
 *
 * Comparison is by parsed cells rather than by exact text: the repo's markdown
 * formatter owns column padding and alignment, so a byte-for-byte match would
 * fail on whitespace the formatter is entitled to change. What must not drift
 * is the list itself.
 */
export function parseWildCorpusTable(documentText) {
  let begin = documentText.indexOf(wildCorpusTableBegin);
  let end = documentText.indexOf(wildCorpusTableEnd);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `${wildCorpusDocPath} must contain ${wildCorpusTableBegin} and ${wildCorpusTableEnd} around its generated table`,
    );
  }
  let cells = (line) =>
    line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((cell) => cell.trim());

  return (
    documentText
      .slice(begin + wildCorpusTableBegin.length, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('|'))
      // Drop the header and its alignment row.
      .slice(2)
      .map((line) => {
        let [position, category, id, path, purpose] = cells(line);
        return {
          category,
          id: id.replaceAll('`', ''),
          path: path.replaceAll('`', ''),
          position: Number(position),
          purpose,
        };
      })
  );
}

/**
 * Splice a freshly rendered table into the doc between its markers.
 *
 * Returns the new document text. Everything outside the markers is prose that
 * belongs to whoever wrote it and is left untouched.
 */
export function withRenderedWildCorpusTable(
  documentText,
  table = renderWildCorpusTable(),
) {
  let begin = documentText.indexOf(wildCorpusTableBegin);
  let end = documentText.indexOf(wildCorpusTableEnd);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `${wildCorpusDocPath} must contain ${wildCorpusTableBegin} and ${wildCorpusTableEnd} around its generated table`,
    );
  }
  return [
    documentText.slice(0, begin),
    wildCorpusTableBegin,
    '\n\n',
    table,
    '\n\n',
    documentText.slice(end),
  ].join('');
}

export function validateWildCorpus(cases) {
  if (cases.length !== 50) {
    throw new Error(
      `The in-the-wild compatibility lane must contain exactly 50 cards; found ${cases.length}`,
    );
  }

  let ids = new Set();
  let paths = new Set();
  let executionModes = new Set(['discover', 'direct', 'capsule', 'sandbox']);

  for (let smokeCase of cases) {
    if (!smokeCase.id || ids.has(smokeCase.id)) {
      throw new Error(`Wild corpus id must be unique: ${smokeCase.id}`);
    }
    if (!smokeCase.path?.startsWith('/ctse/') || paths.has(smokeCase.path)) {
      throw new Error(
        `Wild corpus path must be a unique CTSE card: ${smokeCase.path}`,
      );
    }
    if (!executionModes.has(smokeCase.expectedExecution)) {
      throw new Error(
        `Wild corpus ${smokeCase.id} has an invalid execution mode: ${smokeCase.expectedExecution}`,
      );
    }
    if (
      !smokeCase.category ||
      !smokeCase.purpose ||
      !smokeCase.sourceUrl ||
      smokeCase.referenceParity !== true
    ) {
      throw new Error(
        `Wild corpus ${smokeCase.id} must declare its category, source, purpose, and reference parity`,
      );
    }
    if (!smokeCase.mustContain?.length) {
      throw new Error(
        `Wild corpus ${smokeCase.id} must declare a visible staging signature`,
      );
    }
    if (
      !Number.isInteger(smokeCase.minimumHealthyImages) ||
      smokeCase.minimumHealthyImages < 0
    ) {
      throw new Error(
        `Wild corpus ${smokeCase.id} has an invalid authored-image minimum`,
      );
    }

    ids.add(smokeCase.id);
    paths.add(smokeCase.path);
  }
}
