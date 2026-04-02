/**
 * Prompt template smoke test — assembles and prints the prompts that the
 * factory agent would send to the LLM, using sample data.
 *
 * No API keys, realm server, or network access required.
 *
 * Usage:
 *   pnpm smoke:prompt
 *   pnpm smoke:prompt -- --stage implement
 *   pnpm smoke:prompt -- --stage iterate
 *   pnpm smoke:prompt -- --stage test
 *   pnpm smoke:prompt -- --stage all        (default)
 */

import { parseArgs } from 'node:util';

import type { AgentAction, AgentContext } from '../lib/factory-agent';

import {
  assembleImplementPrompt,
  assembleIteratePrompt,
  assembleSystemPrompt,
  assembleTestPrompt,
  buildOneShotMessages,
  FilePromptLoader,
} from '../lib/factory-prompt-loader';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_CONTEXT: AgentContext = {
  project: {
    id: 'Projects/sticky-note-app',
    objective: 'Build a sticky note card application for Boxel',
    successCriteria: [
      'StickyNote card renders with title and body',
      'Cards can be created and edited in the UI',
      'All tests pass',
    ],
  },
  ticket: {
    id: 'Tickets/define-sticky-note-core',
    summary: 'Define the core StickyNote CardDef',
    status: 'in-progress',
    priority: 'high',
    description:
      'Create a StickyNote card definition with `title` (StringField) and ' +
      '`body` (MarkdownField) fields. Include fitted and isolated templates ' +
      'with a yellow sticky-note visual style. Create a sample instance.',
    checklist: [
      'Create sticky-note.gts with CardDef',
      'Add fitted template with styling',
      'Create sample JSON instance',
      'Write Playwright test spec',
    ],
  },
  knowledge: [
    {
      id: 'Knowledge/card-patterns',
      title: 'Boxel Card Definition Patterns',
      content:
        'Cards use `@field` decorators with `contains()` for primitive fields ' +
        'and `linksTo()` for relationships. Templates use Glimmer syntax with ' +
        '`<template>` blocks and scoped `<style>` tags.',
    },
  ],
  skills: [
    {
      name: 'boxel-development',
      content:
        'Follow Boxel card patterns: use CardDef base class, @field decorators, ' +
        'Component<typeof T> for templates, and scoped CSS.',
      references: ['card-api-reference.md', 'template-guide.md'],
    },
  ],
  tools: [
    {
      name: 'search-realm',
      description: 'Search for cards in a realm by query string',
      category: 'script' as const,
      args: [
        {
          name: 'query',
          type: 'string',
          required: true,
          description: 'Search query',
        },
        {
          name: 'realm',
          type: 'string',
          required: false,
          description: 'Which realm to search (target or test)',
        },
      ],
      outputFormat: 'json' as const,
    },
    {
      name: 'run-realm-tests',
      description: 'Run Playwright tests from the test realm',
      category: 'script' as const,
      args: [],
      outputFormat: 'text' as const,
    },
  ],
  targetRealmUrl: 'http://localhost:4201/user/personal/',
  testRealmUrl: 'http://localhost:4201/user/personal-tests/',
};

const SAMPLE_PREVIOUS_ACTIONS: AgentAction[] = [
  {
    type: 'create_file',
    path: 'sticky-note.gts',
    content:
      'import { contains, field, CardDef } from "@cardstack/base/card-api";\n' +
      'import StringField from "@cardstack/base/string";\n\n' +
      'export class StickyNote extends CardDef {\n' +
      '  @field title = contains(StringField);\n' +
      '}',
    realm: 'target',
  },
  {
    type: 'create_test',
    path: 'TestSpec/sticky-note.spec.ts',
    content:
      'import { test, expect } from "@playwright/test";\n\n' +
      'test("StickyNote renders title", async ({ page }) => {\n' +
      '  await page.goto("/StickyNote/sample");\n' +
      '  await expect(page.locator(".sticky-note h3")).toHaveText("Hello");\n' +
      '});',
    realm: 'test',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function separator(label: string): void {
  let line = '═'.repeat(72);
  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(`${line}\n`);
}

function printMessages(messages: { role: string; content: string }[]): void {
  for (let msg of messages) {
    console.log(`── [${msg.role.toUpperCase()}] ──────────────────────────`);
    console.log(msg.content);
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type Stage = 'all' | 'implement' | 'iterate' | 'test';

function main(): void {
  let { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      stage: { type: 'string', default: 'all' },
    },
    strict: true,
    allowPositionals: true,
  });

  let stage = (values.stage ?? 'all') as Stage;
  if (!['all', 'implement', 'iterate', 'test'].includes(stage)) {
    console.error(
      `Invalid stage: "${stage}". Must be one of: all, implement, iterate, test`,
    );
    process.exit(1);
  }

  let loader = new FilePromptLoader();
  let ctx = SAMPLE_CONTEXT;

  // System prompt (shared across all stages)
  let systemPrompt = assembleSystemPrompt({ context: ctx, loader });

  if (stage === 'all' || stage === 'implement') {
    separator('STAGE: implement (first pass)');
    let userPrompt = assembleImplementPrompt({ context: ctx, loader });
    let messages = buildOneShotMessages(systemPrompt, userPrompt);
    printMessages(messages);
    console.log(
      `📊  System: ${systemPrompt.length} chars | User: ${userPrompt.length} chars`,
    );
  }

  if (stage === 'all' || stage === 'iterate') {
    separator('STAGE: iterate (fix after test failure)');

    let iterateCtx: AgentContext = {
      ...ctx,
      testResults: {
        status: 'failed',
        passedCount: 0,
        failedCount: 1,
        failures: [
          {
            testName: 'StickyNote renders title',
            error:
              'Timed out 5000ms waiting for expect(locator).toHaveText("Hello")\n' +
              'Locator: page.locator(".sticky-note h3")',
            stackTrace: 'at sticky-note.spec.ts:5:42',
          },
        ],
        durationMs: 8500,
      },
    };

    let userPrompt = assembleIteratePrompt({
      context: iterateCtx,
      previousActions: SAMPLE_PREVIOUS_ACTIONS,
      iteration: 2,
      loader,
    });
    let messages = buildOneShotMessages(systemPrompt, userPrompt);
    printMessages(messages);
    console.log(
      `📊  System: ${systemPrompt.length} chars | User: ${userPrompt.length} chars`,
    );
  }

  if (stage === 'all' || stage === 'test') {
    separator('STAGE: test (generate tests for existing implementation)');

    let userPrompt = assembleTestPrompt({
      context: ctx,
      implementedFiles: [
        {
          path: 'sticky-note.gts',
          content: SAMPLE_PREVIOUS_ACTIONS[0].content!,
          realm: 'target',
        },
      ],
      loader,
    });
    let messages = buildOneShotMessages(systemPrompt, userPrompt);
    printMessages(messages);
    console.log(
      `📊  System: ${systemPrompt.length} chars | User: ${userPrompt.length} chars`,
    );
  }

  separator('DONE');
  console.log('All prompt templates assembled successfully.');
  console.log(
    'The prompts above are exactly what the LLM would receive in a one-shot call.',
  );
}

main();
