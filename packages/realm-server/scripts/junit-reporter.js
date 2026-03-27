#!/usr/bin/env node
/* eslint-env node */
'use strict';

// QUnit JUnit XML reporter for CI.
//
// Usage: qunit --reporter junit-reporter.js ...
// Or:    qunit --require ./scripts/junit-reporter.js --reporter console ...
//
// Set JUNIT_OUTPUT_FILE to control the output path (default: junit/realm-server.xml).
// When used as a --require module, this attaches alongside the default console
// reporter so you get both terminal output and a JUnit file.

const fs = require('node:fs'); // eslint-disable-line @typescript-eslint/no-var-requires
const path = require('node:path'); // eslint-disable-line @typescript-eslint/no-var-requires
const QUnit = require('qunit'); // eslint-disable-line @typescript-eslint/no-var-requires

const outputFile =
  process.env.JUNIT_OUTPUT_FILE ||
  path.join(process.cwd(), '..', '..', 'junit', 'realm-server.xml');

const suites = new Map(); // moduleName -> { tests, failures, errors, time, testCases }

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

QUnit.on('testEnd', (data) => {
  const moduleName = data.fullName
    ? data.fullName.slice(0, data.fullName.lastIndexOf(' > '))
    : data.module || 'default';
  const testName = data.name || 'unknown';
  const runtime = (data.runtime || 0) / 1000; // ms → seconds
  const status = data.status; // passed, failed, skipped, todo

  if (!suites.has(moduleName)) {
    suites.set(moduleName, {
      tests: 0,
      failures: 0,
      errors: 0,
      skipped: 0,
      time: 0,
      testCases: [],
    });
  }

  const suite = suites.get(moduleName);
  suite.tests++;
  suite.time += runtime;

  let caseXml = `    <testcase classname="${escapeXml(moduleName)}" name="${escapeXml(testName)}" time="${runtime.toFixed(3)}"`;

  if (status === 'failed') {
    suite.failures++;
    const messages = (data.errors || [])
      .map((e) => {
        let msg = e.message || '';
        if (e.actual !== undefined && e.expected !== undefined) {
          msg += `\nExpected: ${JSON.stringify(e.expected)}\nActual:   ${JSON.stringify(e.actual)}`;
        }
        if (e.stack) {
          msg += `\n${e.stack}`;
        }
        return msg;
      })
      .join('\n---\n');
    caseXml += `>\n      <failure message="${escapeXml((data.errors?.[0]?.message || 'test failed').slice(0, 200))}">${escapeXml(messages)}</failure>\n    </testcase>`;
  } else if (status === 'skipped' || status === 'todo') {
    suite.skipped++;
    caseXml += `>\n      <skipped />\n    </testcase>`;
  } else {
    caseXml += ` />`;
  }

  suite.testCases.push(caseXml);
});

QUnit.on('runEnd', () => {
  const suitesXml = [];
  let totalTests = 0;
  let totalFailures = 0;
  let totalErrors = 0;
  let totalSkipped = 0;
  let totalTime = 0;

  for (const [name, suite] of suites) {
    totalTests += suite.tests;
    totalFailures += suite.failures;
    totalErrors += suite.errors;
    totalSkipped += suite.skipped;
    totalTime += suite.time;

    suitesXml.push(
      `  <testsuite name="${escapeXml(name)}" tests="${suite.tests}" failures="${suite.failures}" errors="${suite.errors}" skipped="${suite.skipped}" time="${suite.time.toFixed(3)}">\n${suite.testCases.join('\n')}\n  </testsuite>`,
    );
  }

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="Realm Server Tests" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}" skipped="${totalSkipped}" time="${totalTime.toFixed(3)}">`,
    ...suitesXml,
    `</testsuites>`,
  ].join('\n');

  const dir = path.dirname(outputFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputFile, xml, 'utf8');
});
