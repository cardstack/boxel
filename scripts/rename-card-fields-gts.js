#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
const path = require('path');

const babelParser = require('@babel/parser');
const babelTraverse = require('@babel/traverse').default;

const ROOT = process.argv[2] || '.';
const MODE = process.argv[3] || 'dry-run'; // "apply" to write changes, "restore" to use .bak
const BACKUP = (process.argv[4] || 'yes') === 'yes';

const renameMap = {
  title: 'cardTitle',
  description: 'cardDescription',
  thumbnailURL: 'cardThumbnailURL',
};

const cardInfoMap = {
  title: 'name',
  description: 'summary',
  thumbnailURL: 'cardThumbnailURL',
};

function getOwn(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function indentLines(text, indent) {
  return text
    .split('\n')
    .map((line) => (line.length ? indent + line : line))
    .join('\n');
}

function renameTemplateSource(source) {
  let changed = false;
  let out = source;

  for (let [oldName, newName] of Object.entries(renameMap)) {
    let modelRe = new RegExp(`@model\\.${oldName}\\b`, 'g');
    let fieldsRe = new RegExp(`@fields\\.${oldName}\\b`, 'g');
    if (modelRe.test(out)) {
      out = out.replace(modelRe, `@model.${newName}`);
      changed = true;
    }
    if (fieldsRe.test(out)) {
      out = out.replace(fieldsRe, `@fields.${newName}`);
      changed = true;
    }
  }

  for (let [oldName, newName] of Object.entries(cardInfoMap)) {
    let modelRe = new RegExp(`@model\\.cardInfo\\.${oldName}\\b`, 'g');
    let fieldsRe = new RegExp(`@fields\\.cardInfo\\.${oldName}\\b`, 'g');
    if (modelRe.test(out)) {
      out = out.replace(modelRe, `@model.cardInfo.${newName}`);
      changed = true;
    }
    if (fieldsRe.test(out)) {
      out = out.replace(fieldsRe, `@fields.cardInfo.${newName}`);
      changed = true;
    }
  }

  return { changed, source: out };
}

function parseScript(source) {
  return babelParser.parse(source, {
    sourceType: 'module',
    plugins: [
      'typescript',
      'decorators-legacy',
      'classProperties',
      'classPrivateProperties',
      'classPrivateMethods',
      'importAssertions',
      'jsx',
    ],
    ranges: true,
  });
}

function hasFieldDecorator(decorators) {
  if (!decorators) return false;
  return decorators.some((decorator) => {
    let expr = decorator.expression;
    return expr && expr.type === 'Identifier' && expr.name === 'field';
  });
}

function addEdit(edits, node, newText) {
  if (node && typeof node.start === 'number' && typeof node.end === 'number') {
    edits.push({ start: node.start, end: node.end, text: newText });
  }
}

function renameCardInfoObjectKeys(valueNode, edits) {
  if (!valueNode || valueNode.type !== 'ObjectExpression') return;
  for (let prop of valueNode.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    let key = prop.key;
    if (prop.computed) continue;
    if (key.type === 'Identifier') {
      let newName = getOwn(cardInfoMap, key.name);
      if (newName) addEdit(edits, key, newName);
    } else if (key.type === 'StringLiteral') {
      let newName = getOwn(cardInfoMap, key.value);
      if (newName) addEdit(edits, key, `'${newName}'`);
    }
  }
}

function collectScriptEdits(source) {
  const edits = [];
  let ast;
  try {
    ast = parseScript(source);
  } catch {
    return edits;
  }

  babelTraverse(ast, {
    ClassProperty(path) {
      let node = path.node;
      if (!node.key || node.key.type !== 'Identifier') return;
      if (!hasFieldDecorator(node.decorators)) return;
      let newName = getOwn(renameMap, node.key.name);
      if (newName) addEdit(edits, node.key, newName);
    },
    MemberExpression(path) {
      let node = path.node;
      if (node.computed || node.property.type !== 'Identifier') return;

      if (node.object.type === 'ThisExpression') {
        let newName = getOwn(renameMap, node.property.name);
        if (newName) addEdit(edits, node.property, newName);
        return;
      }

      if (
        node.object.type === 'MemberExpression' &&
        !node.object.computed &&
        node.object.property.type === 'Identifier' &&
        node.object.property.name === 'cardInfo'
      ) {
        let newName = getOwn(cardInfoMap, node.property.name);
        if (newName) addEdit(edits, node.property, newName);
      }
    },
    OptionalMemberExpression(path) {
      let node = path.node;
      if (node.computed || node.property.type !== 'Identifier') return;

      if (node.object.type === 'ThisExpression') {
        let newName = getOwn(renameMap, node.property.name);
        if (newName) addEdit(edits, node.property, newName);
        return;
      }

      if (
        node.object.type === 'MemberExpression' &&
        !node.object.computed &&
        node.object.property.type === 'Identifier' &&
        node.object.property.name === 'cardInfo'
      ) {
        let newName = getOwn(cardInfoMap, node.property.name);
        if (newName) addEdit(edits, node.property, newName);
      }
    },
    ObjectProperty(path) {
      let node = path.node;
      if (node.computed) return;
      if (node.key.type === 'Identifier' && node.key.name === 'cardInfo') {
        renameCardInfoObjectKeys(node.value, edits);
        return;
      }
      if (node.key.type === 'StringLiteral' && node.key.value === 'cardInfo') {
        renameCardInfoObjectKeys(node.value, edits);
      }
    },
  });

  return edits;
}

function applyEdits(source, edits) {
  if (!edits.length) return source;
  let deduped = [];
  let seen = new Set();
  for (let edit of edits) {
    let key = `${edit.start}:${edit.end}:${edit.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(edit);
  }

  deduped.sort((a, b) => b.start - a.start);
  let out = source;
  for (let edit of deduped) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

function splitTemplates(source) {
  const templateBlocks = [];
  const placeholderPrefix = '/*__TEMPLATE_BLOCK_';
  const placeholderSuffix = '__*/';
  const regex = /(^[ \t]*)<template>[\s\S]*?<\/template>/gm;

  let stripped = source.replace(regex, (match, indent) => {
    let index = templateBlocks.length;
    templateBlocks.push({ raw: match, indent: indent || '' });
    return `${placeholderPrefix}${index}${placeholderSuffix}`;
  });

  return { stripped, templateBlocks, placeholderPrefix, placeholderSuffix };
}

function restoreTemplates(
  source,
  templateBlocks,
  placeholderPrefix,
  placeholderSuffix,
) {
  let out = source;
  for (let i = 0; i < templateBlocks.length; i++) {
    let token = `${placeholderPrefix}${i}${placeholderSuffix}`;
    let { raw, indent } = templateBlocks[i];
    out = out.replace(token, raw);
  }
  return out;
}

function updateTemplateBlock(block) {
  const openTag = '<template>';
  const closeTag = '</template>';
  let start = block.raw.indexOf(openTag);
  let end = block.raw.lastIndexOf(closeTag);
  if (start === -1 || end === -1) return { changed: false, raw: block.raw };

  let inner = block.raw.slice(start + openTag.length, end);
  let { changed, source } = renameTemplateSource(inner);
  if (!changed) return { changed: false, raw: block.raw };

  let rebuilt =
    block.raw.slice(0, start + openTag.length) +
    source +
    block.raw.slice(end);

  return { changed: true, raw: rebuilt };
}

async function processFile(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return { changed: false };
  }

  if (MODE === 'restore') {
    try {
      let backup = await fs.readFile(filePath + '.bak', 'utf8');
      await fs.writeFile(filePath, backup, 'utf8');
      return { changed: backup !== raw };
    } catch {
      return { changed: false };
    }
  }

  const split = splitTemplates(raw);
  let scriptEdits = collectScriptEdits(split.stripped);
  let updated = applyEdits(split.stripped, scriptEdits);

  let templateChanged = false;
  if (split.templateBlocks.length) {
    let updatedBlocks = split.templateBlocks.map((block) => {
      let res = updateTemplateBlock(block);
      if (res.changed) templateChanged = true;
      return { ...block, raw: res.raw };
    });
    split.templateBlocks = updatedBlocks;
  }

  let finalSource = restoreTemplates(
    updated,
    split.templateBlocks,
    split.placeholderPrefix,
    split.placeholderSuffix,
  );

  if (finalSource === raw) return { changed: false };

  if (MODE === 'apply') {
    if (BACKUP) {
      await fs.writeFile(filePath + '.bak', raw, 'utf8');
    }
    await fs.writeFile(filePath, finalSource, 'utf8');
  }

  return { changed: true };
}

async function* walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      yield* walk(full);
    } else if (ent.isFile() && ent.name.endsWith('.gts')) {
      yield full;
    }
  }
}

(async function main() {
  const changedFiles = [];

  for await (const file of walk(ROOT)) {
    const res = await processFile(file);
    if (res.changed) changedFiles.push(file);
  }

  console.log(`Scanned: ${ROOT}`);
  console.log(`Changed: ${changedFiles.length}`);
  if (changedFiles.length) {
    for (const p of changedFiles.slice(0, 200)) console.log(p);
    if (changedFiles.length > 200) {
      console.log(`... and ${changedFiles.length - 200} more`);
    }
  }
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
