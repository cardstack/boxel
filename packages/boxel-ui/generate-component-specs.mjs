#!/usr/bin/env node
// Generate Spec card JSON for each boxel-ui component by parsing its usage.gts.
// See CS-10527.
//
// Writes to packages/catalog/contents/Spec/ — the working tree of the
// cardstack/boxel-catalog repo (cloned via `pnpm --dir packages/catalog
// catalog:setup`). The realm-server's file watcher picks the files up and
// reindexes the catalog locally. On merge to boxel main, the CI mirror
// workflow regenerates from a fresh checkout and pushes to
// cardstack/boxel-catalog.
//
// Flags:
//   --only X    Generate only component X (kebab-case directory name).
//   --quiet     Suppress non-essential logging.

import fs from 'fs';
import path from 'path';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ADDON_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(ADDON_DIR, '..', '..', '..');

const COMPONENTS_DIR = path.join(ADDON_DIR, 'src', 'components');
const CATALOG_DIR = path.join(
  REPO_ROOT,
  'packages',
  'catalog',
  'contents',
  'Spec',
);
const BARREL_FILE = path.join(ADDON_DIR, 'src', 'components.ts');

const SPEC_MODULE = '@cardstack/boxel-ui/components';
const SPEC_FILE_PREFIX = 'boxel-ui-';

// Build a slug → exported-name map from the boxel-ui barrel file. For each
// `import X[, ...] from './components/<slug>/index.gts'` line we record the
// default binding (X). When a slug has multiple import lines (e.g. `message`
// is imported as both `BoxelMessage` and `Message`), prefer the binding
// without the `Boxel` prefix — that's the public-facing name. Components
// whose slug never appears in the barrel are omitted from the map so the
// generator can skip them rather than emit a spec advertising an export
// that doesn't actually exist.
function buildBarrelExportMap() {
  const source = fs.readFileSync(BARREL_FILE, 'utf8');
  const re =
    /^import\s+([A-Za-z0-9_$]+)[^;]*\s+from\s+['"]\.\/components\/([a-z0-9-]+)\/index\.gts['"]/gm;
  const candidates = new Map();
  let m;
  while ((m = re.exec(source)) !== null) {
    const [, binding, slug] = m;
    const existing = candidates.get(slug);
    if (!existing) {
      candidates.set(slug, binding);
      continue;
    }
    const existingHasPrefix = existing.startsWith('Boxel');
    const newHasPrefix = binding.startsWith('Boxel');
    if (existingHasPrefix && !newHasPrefix) {
      candidates.set(slug, binding);
    }
  }
  return candidates;
}

const args = process.argv.slice(2);
const flags = {
  only: argValue(args, '--only'),
  quiet: args.includes('--quiet'),
};

function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return null;
  return argv[i + 1];
}

function log(...m) {
  if (!flags.quiet) console.log(...m);
}

function listComponents() {
  const entries = fs.readdirSync(COMPONENTS_DIR, { withFileTypes: true });
  const components = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const usagePath = path.join(COMPONENTS_DIR, entry.name, 'usage.gts');
    if (!fs.existsSync(usagePath)) continue;
    components.push({ slug: entry.name, usagePath });
  }
  return components.sort((a, b) => a.slug.localeCompare(b.slug));
}

function toPascalCase(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

// Match the primary <FreestyleUsage>...</FreestyleUsage> in a file.
// Convention across all boxel-ui usage.gts files: the first block documents
// the component itself; subsequent blocks are variant demos.
function extractPrimaryUsageBlock(source) {
  const re = /<FreestyleUsage\b([\s\S]*?)>([\s\S]*?)<\/FreestyleUsage>/;
  const m = source.match(re);
  if (!m) return null;
  return { openAttrs: m[1], body: m[2] };
}

function extractStringAttr(text, name) {
  // @name='value' or @name="value"
  const re = new RegExp(
    `@${name}=(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`,
  );
  const m = text.match(re);
  if (!m) return null;
  return (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"');
}

function hasBoolAttr(text, name) {
  // @name={{true}} or @name (presence)
  if (new RegExp(`@${name}=\\{\\{true\\}\\}`).test(text)) return true;
  return false;
}

function extractDefaultValue(text) {
  // @defaultValue='foo' | @defaultValue="foo" | @defaultValue={{true}} | @defaultValue={{this.x}}
  const s = extractStringAttr(text, 'defaultValue');
  if (s !== null) return s;
  const m = text.match(/@defaultValue=\{\{([^}]+)\}\}/);
  if (!m) return null;
  const raw = m[1].trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Identifier or member expression (e.g., "this.defaultType") — render as code.
  return `\`${raw}\``;
}

function extractOptions(text, source) {
  // @options={{array 'a' 'b' 'c'}} | @options={{this.xVariants}} | @options={{validTypes}}
  const arrayMatch = text.match(/@options=\{\{\s*array\s+([^}]+)\}\}/);
  if (arrayMatch) {
    const inner = arrayMatch[1];
    const opts = [];
    const re = /'([^']*)'|"([^"]*)"/g;
    let m;
    while ((m = re.exec(inner)) !== null) {
      opts.push(m[1] ?? m[2]);
    }
    return opts;
  }
  const refMatch = text.match(/@options=\{\{([^}]+)\}\}/);
  if (!refMatch) return null;
  let ref = refMatch[1].trim();
  // Strip leading `this.` so we can look up the class-field declaration.
  ref = ref.replace(/^this\./, '');
  // Try to resolve `<ref> = [<string literals>]` in the source file. Catches
  // both class-field (`pillKinds = ['button', 'default']`) and top-level
  // const (`const validBottomTreatments = [...]`) shapes when they're array
  // literals — which is most of the enum cases in usage.gts files.
  if (source) {
    const re = new RegExp(`(?:^|\\b)${ref}\\s*=\\s*\\[([^\\]]*)\\]`, 'm');
    const m = source.match(re);
    if (m) {
      const opts = [];
      const valRe = /'([^']*)'|"([^"]*)"/g;
      let v;
      while ((v = valRe.exec(m[1])) !== null) {
        opts.push(v[1] ?? v[2]);
      }
      if (opts.length) return opts;
    }
  }
  // Fall back to a labelled reference so the reader at least knows the
  // identifier they'd grep for if they want the values.
  return [`(see ${refMatch[1].trim()})`];
}

function extractNamedBlock(body, blockName) {
  // <:name>...</:name> or <:name as |X|>...</:name>
  const re = new RegExp(
    `<:${blockName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/:${blockName}>`,
  );
  const m = body.match(re);
  return m ? m[1] : null;
}

function parseArgs(apiBlock, source) {
  if (!apiBlock) return [];
  const re = /<Args\.(\w+)([\s\S]*?)\/>/g;
  const args = [];
  let m;
  while ((m = re.exec(apiBlock)) !== null) {
    const kind = m[1];
    const attrs = m[2];
    const name = extractStringAttr(attrs, 'name');
    if (!name && kind !== 'Yield') continue;
    args.push({
      kind,
      name: name ?? '(yield)',
      description: extractStringAttr(attrs, 'description'),
      required: hasBoolAttr(attrs, 'required'),
      optional: hasBoolAttr(attrs, 'optional'),
      defaultValue: extractDefaultValue(attrs),
      options: extractOptions(attrs, source),
    });
  }
  return args;
}

function parseCssVars(cssBlock) {
  if (!cssBlock) return [];
  const re = /<Css\.Basic([\s\S]*?)\/>/g;
  const vars = [];
  let m;
  while ((m = re.exec(cssBlock)) !== null) {
    const attrs = m[1];
    const name = extractStringAttr(attrs, 'name');
    if (!name) continue;
    vars.push({
      name,
      type: extractStringAttr(attrs, 'type'),
      description: extractStringAttr(attrs, 'description'),
    });
  }
  return vars;
}

// Strip Glimmer/HTML markup from a description block to plain prose.
// Keeps <code>...</code> as `...` (markdown inline code).
function htmlToPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// True if the description block is dominated by structural HTML (tables, lists)
// rather than prose. Those flatten badly to plain text and duplicate the API
// table, so we skip them in the readMe.
function isStructuralDescription(html) {
  if (!html) return false;
  return /<(table|tbody|thead|tr|td|ul|ol|li)\b/i.test(html);
}

function trimExample(exampleBlock) {
  if (!exampleBlock) return '';
  // Strip leading/trailing whitespace lines but preserve internal indentation.
  return exampleBlock.replace(/^[ \t]*\n+/, '').replace(/\n+[ \t]*$/, '');
}

// usage.gts files import the component locally as `BoxelButton`, `BoxelInput`,
// `BoxelModal` etc. (aliased from `./index.gts`) so the FreestyleUsage demo
// can co-exist with arg state. But the public export from
// `@cardstack/boxel-ui/components` is the un-prefixed name (`Button`, `Input`,
// `Modal`). The Import section of the readMe correctly shows the public name;
// without rewriting, the Example section would still show the internal alias
// and a reader (human or agent) might copy `BoxelInput` into their imports
// and crash at runtime (CS-10527 second test run did exactly this).
//
// Rewrite `<BoxelX ...>`, `</BoxelX>`, and self-closing `<BoxelX />` to use
// the public name. Tag-name match is anchored on the leading `<` / `</` so
// CSS class names and prose mentioning "Boxel" are not touched.
function normalizeExampleTagNames(text) {
  // The example body is taken verbatim from usage.gts, which uses each
  // component's local import name. Those names happen to be what
  // `@cardstack/boxel-ui/components` re-exports — so for tags like
  // <BoxelInput>, <BoxelSelect>, <BoxelDropdown> the Boxel prefix is the
  // public export and stripping it would point agents at an export that
  // does not exist. Leave the tags as-written.
  return text;
}

function dedent(text) {
  const lines = text.split('\n');
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^[ \t]*/)[0].length);
  if (!indents.length) return text;
  const min = Math.min(...indents);
  if (min === 0) return text;
  return lines.map((l) => l.slice(min)).join('\n');
}

function argTypeLabel(arg) {
  switch (arg.kind) {
    case 'String':
      return 'string';
    case 'Bool':
      return 'boolean';
    case 'Object':
      return 'object';
    case 'Action':
      return 'action';
    case 'Yield':
      return 'block';
    default:
      return arg.kind.toLowerCase();
  }
}

function argRequirednessLabel(arg) {
  if (arg.required) return 'required';
  return 'optional';
}

function defaultValueLabel(v) {
  if (v === null || v === undefined) return '—';
  if (v === true) return '`true`';
  if (v === false) return '`false`';
  if (typeof v === 'string') {
    // Already escaped/coded?
    if (v.startsWith('`') && v.endsWith('`')) return v;
    return `\`${v}\``;
  }
  return String(v);
}

function buildApiTable(args) {
  if (!args.length) return '_No documented arguments._';
  let table = '| Arg | Type | Required | Default | Description |\n';
  table += '| --- | --- | --- | --- | --- |\n';
  for (const arg of args) {
    const desc = arg.description ?? '';
    const options = arg.options
      ? ` Options: ${arg.options.map((o) => (o.startsWith('(') ? o : `\`${o}\``)).join(', ')}.`
      : '';
    const cell = (desc + options).replace(/\|/g, '\\|').trim();
    const nameLabel =
      arg.kind === 'Yield' ? '`(yield block)`' : `\`@${arg.name}\``;
    table += `| ${nameLabel} | ${argTypeLabel(arg)} | ${argRequirednessLabel(arg)} | ${defaultValueLabel(arg.defaultValue)} | ${cell || '—'} |\n`;
  }
  return table.trim();
}

function buildCssTable(vars) {
  if (!vars.length) return '_No documented CSS variables._';
  let table = '| Variable | Type | Description |\n';
  table += '| --- | --- | --- |\n';
  for (const v of vars) {
    const name = v.name.startsWith('--') ? v.name : `--${v.name}`;
    const desc = (v.description ?? '').replace(/\|/g, '\\|').trim();
    table += `| \`${name}\` | ${v.type ?? '—'} | ${desc || '—'} |\n`;
  }
  return table.trim();
}

function synthesizeCardDescription({
  componentName,
  topDescription,
  descriptionText,
  hasStructuralDescription,
}) {
  // Order of preference:
  //   1. Top-level @description on the FreestyleUsage tag (curated by author).
  //   2. First sentence of the <:description> block when it's prose, not a table.
  //   3. Generic placeholder — flagged for follow-up.
  if (topDescription) {
    const lower = topDescription.toLowerCase();
    if (lower.includes(componentName.toLowerCase())) return topDescription;
    return `${componentName} — ${topDescription}`;
  }
  if (descriptionText && !hasStructuralDescription) {
    const firstSentence = descriptionText.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length > 3) {
      const lower = firstSentence.toLowerCase();
      if (lower.includes(componentName.toLowerCase())) return firstSentence;
      return `${componentName} — ${firstSentence}`;
    }
  }
  // Fallback: keyword-thin. Add a top-level @description='...' on the
  // FreestyleUsage tag in usage.gts to override.
  return `${componentName} — boxel-ui component (see readMe for API and example).`;
}

function buildReadme({
  componentName,
  topDescription,
  descriptionText,
  hasStructuralDescription,
  example,
  args,
  cssVars,
}) {
  const sections = [];
  sections.push(`# ${componentName}`);
  // Prefer the curated top-level description; otherwise include the prose
  // <:description> block. Skip when it's structural HTML (the API/CSS tables
  // below already cover that information).
  if (topDescription) {
    sections.push(topDescription);
  } else if (descriptionText && !hasStructuralDescription) {
    sections.push(descriptionText);
  }
  sections.push('## Import');
  sections.push(
    '```ts\n' + `import { ${componentName} } from '${SPEC_MODULE}';\n` + '```',
  );
  sections.push('## API');
  sections.push(buildApiTable(args));
  if (example) {
    sections.push('## Example');
    const trimmed = normalizeExampleTagNames(dedent(trimExample(example)));
    sections.push('```gts\n' + trimmed + '\n```');
  }
  sections.push('## CSS Variables');
  sections.push(buildCssTable(cssVars));
  return sections.join('\n\n') + '\n';
}

function buildSpecJson({ componentName, cardDescription, readMe }) {
  return {
    data: {
      type: 'card',
      attributes: {
        readMe,
        ref: { module: SPEC_MODULE, name: componentName },
        specType: 'component',
        containedExamples: [],
        cardTitle: componentName,
        cardDescription,
        cardInfo: {
          name: null,
          summary: null,
          cardThumbnailURL: null,
          notes: null,
        },
      },
      relationships: {
        linkedExamples: { links: { self: null } },
      },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/spec',
          name: 'Spec',
        },
      },
    },
  };
}

function generateForComponent({ slug, usagePath, barrelExportName }) {
  const source = fs.readFileSync(usagePath, 'utf8');
  const block = extractPrimaryUsageBlock(source);
  if (!block) {
    return { slug, error: 'no FreestyleUsage block found' };
  }
  const topDescription = extractStringAttr(block.openAttrs, 'description');
  const descriptionRaw = extractNamedBlock(block.body, 'description');
  const descriptionText = htmlToPlainText(descriptionRaw);
  const hasStructuralDescription = isStructuralDescription(descriptionRaw);
  const example = extractNamedBlock(block.body, 'example');
  const apiBlock = extractNamedBlock(block.body, 'api');
  const cssBlock = extractNamedBlock(block.body, 'cssVars');

  const args = parseArgs(apiBlock, source);
  const cssVars = parseCssVars(cssBlock);

  // Component name must match what `@cardstack/boxel-ui/components` actually
  // exports — the spec's `ref.name` and the import statement in the readMe
  // both use it directly. Always prefer the barrel-derived name; the
  // FreestyleUsage `@name` attribute is a display label and frequently
  // diverges (e.g. `<FreestyleUsage @name='Input'>` for the BoxelInput export,
  // `@name='Field'` for FieldContainer). PascalCase-of-slug is the last-resort
  // fallback for slugs not present in the barrel — those are caught earlier
  // by the main loop and skipped.
  const componentName = barrelExportName ?? toPascalCase(slug);

  const cardDescription = synthesizeCardDescription({
    componentName,
    topDescription,
    descriptionText,
    hasStructuralDescription,
  });

  const readMe = buildReadme({
    componentName,
    topDescription,
    descriptionText,
    hasStructuralDescription,
    example,
    args,
    cssVars,
  });

  const spec = buildSpecJson({ componentName, cardDescription, readMe });
  return { slug, componentName, spec };
}

function specFileName(slug) {
  return `${SPEC_FILE_PREFIX}${slug}.json`;
}

function serializeSpec(spec) {
  return JSON.stringify(spec, null, 2) + '\n';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeOutput(slug, spec) {
  const json = serializeSpec(spec);
  ensureDir(CATALOG_DIR);
  fs.writeFileSync(path.join(CATALOG_DIR, specFileName(slug)), json);
}

function main() {
  if (!fs.existsSync(path.dirname(CATALOG_DIR))) {
    console.error(
      `packages/catalog/contents/ is not present. Run 'pnpm --dir packages/catalog catalog:setup' first, then re-run this command.`,
    );
    process.exit(2);
  }

  let components = listComponents();
  if (flags.only) {
    components = components.filter((c) => c.slug === flags.only);
    if (!components.length) {
      console.error(`No component named '${flags.only}'`);
      process.exit(2);
    }
  }

  const barrelExports = buildBarrelExportMap();

  // A slug that lives under src/components/ but isn't reachable from the
  // barrel has no `@cardstack/boxel-ui/components` export — emitting a spec
  // for it would advertise an import path agents can't actually use. Skip
  // and log so the omission is visible.
  const skipped = components.filter((c) => !barrelExports.has(c.slug));
  for (const c of skipped) {
    log(`  skipping ${c.slug}: no export from @cardstack/boxel-ui/components`);
  }
  const eligible = components.filter((c) => barrelExports.has(c.slug));

  const results = eligible.map((c) =>
    generateForComponent({ ...c, barrelExportName: barrelExports.get(c.slug) }),
  );
  const errors = results.filter((r) => r.error);
  if (errors.length) {
    for (const e of errors) console.error(`! ${e.slug}: ${e.error}`);
    process.exit(2);
  }

  for (const r of results) {
    writeOutput(r.slug, r.spec);
    log(`✓ ${specFileName(r.slug)}`);
  }

  // Sweep stale `boxel-ui-<slug>.json` files: previous runs may have written
  // specs for slugs no longer eligible (removed from the addon, or excluded
  // because the barrel does not re-export them). Those files would otherwise
  // linger in the catalog and continue to mislead agents.
  const expected = new Set(eligible.map((c) => specFileName(c.slug)));
  for (const entry of fs.readdirSync(CATALOG_DIR)) {
    if (!entry.startsWith(SPEC_FILE_PREFIX) || !entry.endsWith('.json')) {
      continue;
    }
    if (!expected.has(entry)) {
      fs.unlinkSync(path.join(CATALOG_DIR, entry));
      log(`  removed stale ${entry}`);
    }
  }

  log(
    `Wrote ${results.length} spec(s) to ${path.relative(REPO_ROOT, CATALOG_DIR)}/.`,
  );
}

main();
