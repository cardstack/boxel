#!/usr/bin/env node

const { parseArgs } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const {
    values: { input: inputArgs = [], tests: testsPath = 'failed-tests.json', modules: modulesPath = 'failed-modules.json' },
  } = parseArgs({
    options: {
      input: { type: 'string', multiple: true, short: 'i' },
      tests: { type: 'string', short: 't' },
      modules: { type: 'string', short: 'm' },
    },
  });

  if (inputArgs.length === 0) {
    throw new Error('At least one --input path is required');
  }

  const xmlFiles = [];
  for (const entry of inputArgs) {
    await collectXmlFiles(path.resolve(entry), xmlFiles);
  }

  xmlFiles.sort();

  const failedTests = [];
  const failedModulesSet = new Set();

  for (const file of xmlFiles) {
    const content = await fs.readFile(file, 'utf8');
    const cases = extractFailingTestcases(content);
    for (const testCase of cases) {
      const title = testCase.name ?? '[unknown test name]';
      failedTests.push(title);

      const moduleName = determineModuleName(testCase);
      if (moduleName) {
        failedModulesSet.add(moduleName);
      }
    }
  }

  const modules = Array.from(failedModulesSet);

  await writeJson(testsPath, failedTests);
  await writeJson(modulesPath, modules);

  const sampleTests = failedTests.slice(0, 10).join(', ');
  console.error(
    `[collect-failures] scanned ${xmlFiles.length} XML files, found ${failedTests.length} failing tests across ${modules.length} modules.`
  );
  if (failedTests.length > 0) {
    console.error(`[collect-failures] sample failing tests: ${sampleTests}`);
  }

  const summary = { count: failedTests.length, modules: modules.length };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

async function collectXmlFiles(targetPath, results) {
  let stats;
  try {
    stats = await fs.stat(targetPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (stats.isDirectory()) {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      await collectXmlFiles(path.join(targetPath, entry.name), results);
    }
  } else if (stats.isFile() && targetPath.toLowerCase().endsWith('.xml')) {
    results.push(targetPath);
  }
}

function extractFailingTestcases(xmlContent) {
  const failing = [];
  const testcasePattern = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/gi;
  let match;

  while ((match = testcasePattern.exec(xmlContent)) !== null) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    if (!/(<failure\b|<error\b)/i.test(body)) {
      continue;
    }

    failing.push({
      name: extractAttribute(attributes, 'name'),
      classname: extractAttribute(attributes, 'classname'),
    });
  }

  return failing;
}

function extractAttribute(attributeBlock, attributeName) {
  if (!attributeBlock) {
    return undefined;
  }
  const pattern = new RegExp(`(?:^|\\s)${attributeName}="([^"]*)"`, 'i');
  const doubleQuotedMatch = pattern.exec(attributeBlock);
  if (doubleQuotedMatch) {
    return decodeEntities(doubleQuotedMatch[1]);
  }

  const singlePattern = new RegExp(`(?:^|\\s)${attributeName}='([^']*)'`, 'i');
  const singleMatch = singlePattern.exec(attributeBlock);
  if (singleMatch) {
    return decodeEntities(singleMatch[1]);
  }

  return undefined;
}

function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function determineModuleName(testCase) {
  const className = testCase.classname;
  if (className && !/^Chrome\b/i.test(className.trim())) {
    return className.trim();
  }

  const title = testCase.name;
  if (!title) {
    return undefined;
  }

  const separatorIndex = title.lastIndexOf(':');
  if (separatorIndex === -1) {
    return title.trim();
  }

  return title.slice(0, separatorIndex).trim();
}

async function writeJson(targetPath, data) {
  const directory = path.dirname(targetPath);
  if (directory && directory !== '.') {
    await fs.mkdir(directory, { recursive: true });
  }
  await fs.writeFile(targetPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
