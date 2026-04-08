/**
 * Smoke test for the ContextBuilder.
 *
 * No servers, no API keys — exercises the full context assembly pipeline
 * using real skill files from disk and the real SkillResolver/SkillLoader.
 *
 * Usage:
 *   pnpm smoke:context
 *   pnpm smoke:context --max-tokens 8000
 */

import { parseArgs } from 'node:util';

import type {
  KnowledgeArticleData,
  ProjectData,
  IssueData,
} from '../lib/factory-agent';
import { ContextBuilder } from '../lib/factory-context-builder';
import {
  DefaultSkillResolver,
  estimateTokens,
  SkillLoader,
} from '../lib/factory-skill-loader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.log(`  \u2717 ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_PROJECT: ProjectData = {
  id: 'Projects/sticky-notes',
  name: 'Sticky Notes MVP',
};

const SAMPLE_KNOWLEDGE: KnowledgeArticleData[] = [
  {
    id: 'Knowledge/card-basics',
    title: 'Boxel Card Development Basics',
    body: 'Cards are defined as .gts files with CardDef base class...',
  },
  {
    id: 'Knowledge/testing-guide',
    title: 'Playwright Testing Guide',
    body: 'Tests live in Tests/ folder as .spec.ts files...',
  },
];

const SAMPLE_ISSUES: { label: string; issue: IssueData }[] = [
  {
    label: 'Card definition (.gts work)',
    issue: {
      id: 'Issues/define-sticky-note',
      title: 'Define StickyNote card',
      description:
        'Create a .gts card definition for StickyNote with title, body, and color fields. Include fitted and isolated views.',
    },
  },
  {
    label: 'Factory workflow issue',
    issue: {
      id: 'Issues/improve-orchestrator',
      title: 'Improve factory delivery pipeline',
      description:
        'Update the factory orchestrator to handle multi-issue workflows with better error recovery.',
    },
  },
  {
    label: 'Minimal issue (base case)',
    issue: {
      id: 'Issues/add-timestamps',
      title: 'Add timestamp fields',
      description: 'Add createdAt and updatedAt fields to the card.',
    },
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'max-tokens': { type: 'string' },
    },
    strict: true,
    allowPositionals: true,
  });

  let maxSkillTokens = values['max-tokens']
    ? Number(values['max-tokens'])
    : undefined;

  if (
    values['max-tokens'] !== undefined &&
    (maxSkillTokens === undefined ||
      !Number.isFinite(maxSkillTokens) ||
      maxSkillTokens <= 0)
  ) {
    console.error(
      `Invalid value for --max-tokens: "${values['max-tokens']}". ` +
        'Please provide a positive numeric value.',
    );
    process.exit(1);
  }

  let builder = new ContextBuilder({
    skillResolver: new DefaultSkillResolver(),
    skillLoader: new SkillLoader(),
    maxSkillTokens,
  });

  console.log('');
  console.log('=== Context Builder Smoke Test ===');
  console.log('');

  for (let { label, issue } of SAMPLE_ISSUES) {
    console.log(`--- ${label} ---`);
    console.log(`  Issue: ${issue.title}`);
    console.log('');

    // -------------------------------------------------------------------
    // First pass (no test results)
    // -------------------------------------------------------------------

    let ctx = await builder.build({
      project: SAMPLE_PROJECT,
      issue,
      knowledge: SAMPLE_KNOWLEDGE,
      targetRealmUrl: 'https://example.test/user/target/',
    });

    console.log('  First pass (no test results):');
    check('project.id set', ctx.project.id === SAMPLE_PROJECT.id);
    check('issue.id set', ctx.issue.id === issue.id);
    check(
      `knowledge: ${ctx.knowledge.length} article(s)`,
      ctx.knowledge.length === SAMPLE_KNOWLEDGE.length,
    );
    check(`skills: ${ctx.skills.length} loaded`, ctx.skills.length > 0);
    check(
      'tools not set (provided separately as FactoryTool[])',
      ctx.tools === undefined,
    );
    check('testResults not set', ctx.testResults === undefined);
    check(
      'targetRealmUrl set',
      ctx.targetRealmUrl === 'https://example.test/user/target/',
    );

    let totalTokens = ctx.skills.reduce((s, sk) => s + estimateTokens(sk), 0);
    console.log(`  Skill breakdown (~${totalTokens} total tokens):`);
    for (let skill of ctx.skills) {
      let tokens = estimateTokens(skill);
      let refCount = skill.references?.length ?? 0;
      let refNote = refCount > 0 ? ` + ${refCount} ref(s)` : '';
      console.log(`    - ${skill.name}: ~${tokens} tokens${refNote}`);
    }

    // -------------------------------------------------------------------
    // Iteration pass (with failed test results)
    // -------------------------------------------------------------------

    let ctxWithResults = await builder.build({
      project: SAMPLE_PROJECT,
      issue,
      knowledge: SAMPLE_KNOWLEDGE,
      targetRealmUrl: 'https://example.test/user/target/',
      testResults: {
        status: 'failed',
        passedCount: 2,
        failedCount: 1,
        failures: [
          {
            testName: 'renders fitted view',
            error: 'Expected element [data-test-card] to exist',
            stackTrace: 'at tests/sticky-note.spec.ts:15:5',
          },
        ],
        durationMs: 8500,
      },
    });

    console.log('');
    console.log('  Iteration pass (with failed test results):');
    check(
      'testResults.status = failed',
      ctxWithResults.testResults?.status === 'failed',
    );
    check(
      'testResults.failedCount = 1',
      ctxWithResults.testResults?.failedCount === 1,
    );
    check(
      'testResults.failures[0] has error',
      ctxWithResults.testResults?.failures[0]?.error?.includes(
        'Expected element',
      ) ?? false,
    );
    check(
      'skills still loaded on iteration',
      ctxWithResults.skills.length === ctx.skills.length,
    );
    check(
      'deprecated fields not set',
      ctxWithResults.toolResults === undefined &&
        ctxWithResults.previousActions === undefined &&
        ctxWithResults.iteration === undefined,
    );

    console.log('');
  }

  // -----------------------------------------------------------------------
  // Budget enforcement
  // -----------------------------------------------------------------------

  if (maxSkillTokens) {
    console.log(`--- Budget enforcement (${maxSkillTokens} tokens) ---`);
    console.log('');

    let ctx = await builder.build({
      project: SAMPLE_PROJECT,
      issue: SAMPLE_ISSUES[0].issue,
      knowledge: [],
      targetRealmUrl: 'https://example.test/user/target/',
    });

    let totalTokens = ctx.skills.reduce((s, sk) => s + estimateTokens(sk), 0);
    check(
      `${ctx.skills.length} skills within budget (~${totalTokens} tokens <= ${maxSkillTokens})`,
      totalTokens <= maxSkillTokens,
    );
    for (let skill of ctx.skills) {
      console.log(`    - ${skill.name}: ~${estimateTokens(skill)} tokens`);
    }
    console.log('');
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  console.log('===========================');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('===========================');
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(
    'Smoke test failed:',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
