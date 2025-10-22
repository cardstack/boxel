#!/usr/bin/env node

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const catalogRoot = path.join(repoRoot, 'packages', 'catalog-realm');
const sourceDir = path.join(catalogRoot, 'StyleReference', '_source');
const datasetPath = path.join(sourceDir, 'style-references.json');
const listingConfigPath = path.join(
  sourceDir,
  'style-reference-listing.json',
);
const outputDir = path.join(catalogRoot, 'StyleReference');
const listingOutputPath = path.join(
  catalogRoot,
  'StyleReferenceListing',
  'style-reference-library.json',
);

const COLOR_PATTERN =
  /^(#([0-9a-fA-F]{3,8})|oklch\([^)]+\)|rgba?\([^)]+\)|hsla?\([^)]+\))$/;

const THEME_COLOR_KEYS = new Set([
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'destructive',
  'destructiveForeground',
  'border',
  'input',
  'ring',
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
  'sidebar',
  'sidebarForeground',
  'sidebarPrimary',
  'sidebarPrimaryForeground',
  'sidebarAccent',
  'sidebarAccentForeground',
  'sidebarBorder',
  'sidebarRing',
]);

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    listOnly: false,
    updateListing: false,
    batch: undefined,
    slugs: undefined,
    silent: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    switch (token) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--list':
        args.listOnly = true;
        break;
      case '--update-listing':
        args.updateListing = true;
        break;
      case '--silent':
        args.silent = true;
        break;
      case '--batch': {
        const start = Number(argv[i + 1]);
        const end = Number(argv[i + 2]);
        if (
          Number.isNaN(start) ||
          Number.isNaN(end) ||
          !Number.isFinite(start) ||
          !Number.isFinite(end)
        ) {
          throw new Error('`--batch` expects two numeric arguments.');
        }
        args.batch = { start, end };
        i += 2;
        break;
      }
      case '--slug':
      case '--slugs': {
        const value = argv[i + 1];
        if (!value) {
          throw new Error('`--slug` expects a comma-separated list.');
        }
        args.slugs = value.split(',').map((item) => item.trim());
        i += 1;
        break;
      }
      default:
        if (token.startsWith('--')) {
          throw new Error(`Unknown option: ${token}`);
        }
    }
  }

  return args;
}

function pickEntries(dataset, args) {
  let entries = [...dataset];

  if (args.slugs?.length) {
    const wanted = new Set(args.slugs);
    entries = entries.filter((entry) => wanted.has(entry.slug));
  }

  if (args.batch) {
    const { start, end } = args.batch;
    if (start < 0 || end < start || end >= dataset.length) {
      throw new Error(
        `Batch range out of bounds. dataset length=${dataset.length}, requested ${start}-${end}`,
      );
    }
    const slice = dataset.slice(start, end + 1);
    entries = entries.filter((entry) =>
      slice.some((candidate) => candidate.slug === entry.slug),
    );
  }

  // Keep order consistent with dataset.
  const slugIndex = new Map(dataset.map((entry, idx) => [entry.slug, idx]));
  entries.sort(
    (a, b) => slugIndex.get(a.slug) - slugIndex.get(b.slug),
  );
  return entries;
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function validateThemeValues(map, slug, mode) {
  for (const [key, value] of Object.entries(map ?? {})) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(
        `Theme value ${mode}.${key} for ${slug} must be a non-empty string.`,
      );
    }
    if (THEME_COLOR_KEYS.has(key)) {
      if (!COLOR_PATTERN.test(value.trim())) {
        throw new Error(
          `Color ${mode}.${key} for ${slug} must be hex/oklch/rgb/hsl (received "${value}").`,
        );
      }
    }
  }
}

function buildCard(entry) {
  const {
    slug,
    styleName,
    visualDNA,
    inspirations,
    wallpaperImages,
    cssImports,
    cardInfo,
    rootVariables,
    darkModeVariables,
  } = entry;

  assertString(slug, 'slug');
  assertString(styleName, 'styleName');
  assertString(visualDNA, 'visualDNA');
  if (!Array.isArray(inspirations) || inspirations.length === 0) {
    throw new Error(`${slug}: inspirations must be a non-empty array.`);
  }
  if (!Array.isArray(wallpaperImages) || wallpaperImages.length === 0) {
    throw new Error(`${slug}: wallpaperImages must be a non-empty array.`);
  }
  if (!cardInfo) {
    throw new Error(`${slug}: cardInfo is required.`);
  }
  validateThemeValues(rootVariables ?? {}, slug, 'rootVariables');
  validateThemeValues(darkModeVariables ?? {}, slug, 'darkModeVariables');

  const card = {
    data: {
      meta: {
        adoptsFrom: {
          name: 'default',
          module: 'https://cardstack.com/base/style-reference',
        },
      },
      type: 'card',
      attributes: {
        styleName,
        visualDNA,
        inspirations,
        wallpaperImages,
        ...(cssImports?.length ? { cssImports } : {}),
        cardInfo: {
          notes: cardInfo.notes ?? null,
          title: cardInfo.title ?? null,
          description: cardInfo.description ?? null,
          thumbnailURL: cardInfo.thumbnailURL ?? null,
        },
        ...(rootVariables ? { rootVariables } : {}),
        ...(darkModeVariables ? { darkModeVariables } : {}),
      },
      relationships: {
        'cardInfo.theme': {
          links: {
            self: null,
          },
        },
      },
    },
  };

  return card;
}

function buildListing(config, examples) {
  const {
    name,
    images,
    summary,
    cardInfo,
    specs,
    categories,
    tags,
    skills,
    license,
    publisher,
  } = config;

  const relationships = {};

  const addCollection = (prefix, values = []) => {
    if (!values.length) {
      relationships[prefix] = {
        links: {
          self: null,
        },
      };
      return;
    }
    values.forEach((value, index) => {
      relationships[`${prefix}.${index}`] = {
        links: {
          self: value ?? null,
        },
      };
    });
  };

  const addSingle = (key, value) => {
    relationships[key] = {
      links: {
        self: value ?? null,
      },
    };
  };

  addCollection('tags', tags);
  addCollection('skills', skills);
  addSingle('license', license ?? null);
  if (specs?.length) {
    addCollection('specs', specs);
  }
  addSingle('publisher', publisher ?? null);
  if (examples?.length) {
    addCollection('examples', examples);
  }
  if (categories?.length) {
    addCollection('categories', categories);
  }
  addSingle('cardInfo.theme', null);

  return {
    data: {
      meta: {
        adoptsFrom: {
          name: 'StyleReferenceListing',
          module: '../catalog-app/listing/listing',
        },
      },
      type: 'card',
      attributes: {
        name,
        images,
        summary,
        cardInfo: {
          notes: cardInfo?.notes ?? null,
          title: cardInfo?.title ?? null,
          description: cardInfo?.description ?? null,
          thumbnailURL: cardInfo?.thumbnailURL ?? null,
        },
      },
      relationships,
    },
  };
}

function resolveExampleLinks(exampleSlugs) {
  return exampleSlugs.map(
    (slug) => `../StyleReference/${slug}`,
  );
}

async function ensureDir(dirPath) {
  try {
    await access(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

async function writeJson(filePath, data, dryRun) {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  if (dryRun) {
    return false;
  }
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, 'utf-8');
  return true;
}

function log(message, { silent } = { silent: false }) {
  if (!silent) {
    process.stdout.write(`${message}\n`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = await readJson(datasetPath);

  if (args.listOnly) {
    dataset.forEach((entry, index) => {
      log(`${index}: ${entry.slug}`, { silent: false });
    });
    return;
  }

  const entries = pickEntries(dataset, args);

  if (!entries.length) {
    throw new Error('No entries selected. Use --list to inspect available slugs.');
  }

  let writes = 0;

  for (const entry of entries) {
    const card = buildCard(entry);
    const targetPath = path.join(outputDir, `${entry.slug}.json`);
    await writeJson(targetPath, card, args.dryRun);
    writes += 1;
    log(`Generated ${entry.slug}`, { silent: args.silent });
  }

  if (args.updateListing) {
    const config = await readJson(listingConfigPath);
    const exampleSlugs = config.exampleSlugs ?? [];
    const missing = exampleSlugs.filter(
      (slug) => !dataset.some((entry) => entry.slug === slug),
    );
    if (missing.length) {
      throw new Error(
        `Listing config references unknown slugs: ${missing.join(', ')}`,
      );
    }
    const listingCard = buildListing(
      config,
      resolveExampleLinks(exampleSlugs),
    );
    await writeJson(listingOutputPath, listingCard, args.dryRun);
    log(
      `Updated listing card with ${exampleSlugs.length} examples.`,
      { silent: args.silent },
    );
  }

  log(
    `${args.dryRun ? 'Checked' : 'Wrote'} ${writes} Style Reference card(s).`,
    { silent: args.silent },
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
