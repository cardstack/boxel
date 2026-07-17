/**
 * Smoke test for the SkillResolver and SkillLoader.
 *
 * No servers, no API keys — runs entirely against local skill files on disk.
 *
 * Usage:
 *   pnpm smoke:skill
 *   pnpm smoke:skill --max-tokens 8000
 *   pnpm smoke:skill --issue-text "Create a .gts component with styling"
 */

// This should be first
import '../../src/setup-logger.ts';

import { parseArgs } from 'node:util';
import { logger } from '../../src/logger.ts';

import {
  DefaultSkillResolver,
  SkillLoader,
  enforceSkillBudget,
  estimateTokens,
} from '../../src/factory-skill-loader.ts';
import type { ProjectData, IssueData } from '../../src/factory-agent/index.ts';

const SAMPLE_ISSUES: { label: string; issue: IssueData }[] = [
  {
    label: 'Generic card work (base case)',
    issue: {
      id: 'Issues/generic',
      title: 'Create a contact card',
      description: 'Build a contact card with name, email, and phone fields.',
    },
  },
  {
    label: '.gts component work (triggers UI skill suggestions)',
    issue: {
      id: 'Issues/gts-component',
      title: 'Build a dashboard component',
      description:
        'Create a .gts component for the dashboard with template and styling.',
    },
  },
  {
    label: 'Factory workflow (triggers software-factory-operations)',
    issue: {
      id: 'Issues/factory-workflow',
      title: 'Improve factory delivery pipeline',
      description:
        'Update the factory orchestrator to handle multi-issue workflows.',
    },
  },
  {
    label:
      'Realm sync work (CLI skills excluded — no boxel-cli tools in registry)',
    issue: {
      id: 'Issues/sync-work',
      title: 'Sync and restore workspace',
      description:
        'Sync local workspace changes to staging, then restore a checkpoint.',
    },
  },
];

let log = logger('factory-skill-smoke');

async function main(): Promise<void> {
  let { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'max-tokens': { type: 'string' },
      'issue-text': { type: 'string' },
    },
    strict: true,
    allowPositionals: true,
  });

  let maxTokens = values['max-tokens']
    ? Number(values['max-tokens'])
    : undefined;

  if (
    values['max-tokens'] !== undefined &&
    (maxTokens === undefined || !Number.isFinite(maxTokens) || maxTokens <= 0)
  ) {
    log.error(
      `Invalid value for --max-tokens: "${values['max-tokens']}". ` +
        'Please provide a positive numeric value.',
    );
    process.exit(1);
  }

  let customIssueText = values['issue-text'];

  let resolver = new DefaultSkillResolver();
  let loader = new SkillLoader();
  let project: ProjectData = { id: 'Projects/smoke-test' };

  log.info('=== Skill Loader & Resolver Smoke Test ===\n');

  // If custom issue text is provided, use only that
  let issues = customIssueText
    ? [
        {
          label: `Custom: "${customIssueText}"`,
          issue: {
            id: 'Issues/custom',
            title: customIssueText,
            description: customIssueText,
          } as IssueData,
        },
      ]
    : SAMPLE_ISSUES;

  for (let { label, issue } of issues) {
    log.info(`--- ${label} ---`);
    log.info(`  Issue: ${issue.title}`);

    // 1. Resolve
    let { load: skillNames, suggested } = resolver.resolve(issue, project);
    log.info(`  Front-loaded skills: [${skillNames.join(', ')}]`);
    log.info(`  Suggested (on demand): [${suggested.join(', ')}]`);

    // 2. Load the front-loaded set
    let skills = await loader.loadAll(skillNames);
    log.info(`  Loaded: ${skills.length}/${skillNames.length} skills`);

    for (let skill of skills) {
      let tokens = estimateTokens(skill);
      let refCount = skill.references?.length ?? 0;
      let refNote = refCount > 0 ? ` + ${refCount} reference(s)` : '';
      log.info(`    - ${skill.name}: ~${tokens} tokens${refNote}`);
    }

    // 3. Budget enforcement
    if (maxTokens) {
      let budgeted = enforceSkillBudget(skills, maxTokens);
      let totalBefore = skills.reduce((s, sk) => s + estimateTokens(sk), 0);
      let totalAfter = budgeted.reduce((s, sk) => s + estimateTokens(sk), 0);
      log.info(
        `  Budget (${maxTokens} tokens): ` +
          `${budgeted.length}/${skills.length} skills kept ` +
          `(${totalAfter}/${totalBefore} tokens)`,
      );
      if (budgeted.length < skills.length) {
        let dropped = skills.filter(
          (s) => !budgeted.find((b) => b.name === s.name),
        );
        log.info(`  Dropped: [${dropped.map((d) => d.name).join(', ')}]`);
      }
    }
  }

  // Summary: the on-demand skill index (what read_skill exposes)
  log.info('--- On-demand skill index ---');
  let index = await loader.buildIndex();
  let grandTotal = 0;
  for (let entry of index) {
    let skill = await loader.load(entry.name);
    let tokens = estimateTokens(skill);
    grandTotal += tokens;
    let refCount = skill.references?.length ?? 0;
    let refNote = refCount > 0 ? ` (${refCount} refs)` : '';
    log.info(`  ${entry.name}: ~${tokens} tokens${refNote}`);
  }
  log.info(
    `  Total: ~${grandTotal} tokens across ${index.length} indexed skills ` +
      '(loaded on demand, never all at once)',
  );

  log.info('\nSmoke test passed.');
}

main().catch((err) => {
  log.error('Smoke test failed:', err);
  process.exit(1);
});
