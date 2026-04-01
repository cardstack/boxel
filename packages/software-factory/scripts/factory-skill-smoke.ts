/**
 * Smoke test for the SkillResolver and SkillLoader.
 *
 * No servers, no API keys — runs entirely against local skill files on disk.
 *
 * Usage:
 *   pnpm factory:skill-smoke
 *   pnpm factory:skill-smoke --max-tokens 8000
 *   pnpm factory:skill-smoke --ticket-text "Create a .gts component with styling"
 */

import { parseArgs } from 'node:util';

import {
  DefaultSkillResolver,
  SkillLoader,
  enforceSkillBudget,
  estimateTokens,
} from './lib/factory-skill-loader';
import type { ProjectCard, TicketCard } from './lib/factory-agent';

const SAMPLE_TICKETS: { label: string; ticket: TicketCard }[] = [
  {
    label: 'Generic card work (base case)',
    ticket: {
      id: 'Tickets/generic',
      title: 'Create a contact card',
      description: 'Build a contact card with name, email, and phone fields.',
    },
  },
  {
    label: '.gts component work (triggers ember-best-practices)',
    ticket: {
      id: 'Tickets/gts-component',
      title: 'Build a dashboard component',
      description:
        'Create a .gts component for the dashboard with template and styling.',
    },
  },
  {
    label: 'Factory workflow (triggers software-factory-operations)',
    ticket: {
      id: 'Tickets/factory-workflow',
      title: 'Improve factory delivery pipeline',
      description:
        'Update the factory orchestrator to handle multi-ticket workflows.',
    },
  },
  {
    label: 'Realm sync work (triggers CLI skills)',
    ticket: {
      id: 'Tickets/sync-work',
      title: 'Sync and restore workspace',
      description:
        'Sync local workspace changes to staging, then restore a checkpoint.',
    },
  },
];

async function main(): Promise<void> {
  let { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'max-tokens': { type: 'string' },
      'ticket-text': { type: 'string' },
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
    console.error(
      `Invalid value for --max-tokens: "${values['max-tokens']}". ` +
        'Please provide a positive numeric value.',
    );
    process.exit(1);
  }

  let customTicketText = values['ticket-text'];

  let resolver = new DefaultSkillResolver();
  let loader = new SkillLoader();
  let project: ProjectCard = { id: 'Projects/smoke-test' };

  console.log('=== Skill Loader & Resolver Smoke Test ===\n');

  // If custom ticket text is provided, use only that
  let tickets = customTicketText
    ? [
        {
          label: `Custom: "${customTicketText}"`,
          ticket: {
            id: 'Tickets/custom',
            title: customTicketText,
            description: customTicketText,
          } as TicketCard,
        },
      ]
    : SAMPLE_TICKETS;

  for (let { label, ticket } of tickets) {
    console.log(`--- ${label} ---`);
    console.log(`  Ticket: ${ticket.title}`);

    // 1. Resolve
    let skillNames = resolver.resolve(ticket, project);
    console.log(`  Resolved skills: [${skillNames.join(', ')}]`);

    // 2. Load (with ticket context for reference filtering)
    let skills = await loader.loadAll(skillNames, ticket);
    console.log(`  Loaded: ${skills.length}/${skillNames.length} skills`);

    for (let skill of skills) {
      let tokens = estimateTokens(skill);
      let refCount = skill.references?.length ?? 0;
      let refNote = refCount > 0 ? ` + ${refCount} reference(s)` : '';
      console.log(`    - ${skill.name}: ~${tokens} tokens${refNote}`);
    }

    // 3. Budget enforcement
    if (maxTokens) {
      let budgeted = enforceSkillBudget(skills, maxTokens);
      let totalBefore = skills.reduce((s, sk) => s + estimateTokens(sk), 0);
      let totalAfter = budgeted.reduce((s, sk) => s + estimateTokens(sk), 0);
      console.log(
        `  Budget (${maxTokens} tokens): ` +
          `${budgeted.length}/${skills.length} skills kept ` +
          `(${totalAfter}/${totalBefore} tokens)`,
      );
      if (budgeted.length < skills.length) {
        let dropped = skills.filter(
          (s) => !budgeted.find((b) => b.name === s.name),
        );
        console.log(`  Dropped: [${dropped.map((d) => d.name).join(', ')}]`);
      }
    }

    console.log();
  }

  // Summary: list all discoverable skills
  console.log('--- All discoverable skills ---');
  let allSkillNames = [
    'boxel-development',
    'boxel-file-structure',
    'ember-best-practices',
    'software-factory-operations',
    'boxel-sync',
    'boxel-track',
    'boxel-watch',
    'boxel-restore',
    'boxel-repair',
    'boxel-setup',
  ];

  let allSkills = await loader.loadAll(allSkillNames);
  let grandTotal = 0;
  for (let skill of allSkills) {
    let tokens = estimateTokens(skill);
    grandTotal += tokens;
    let refCount = skill.references?.length ?? 0;
    let refNote = refCount > 0 ? ` (${refCount} refs)` : '';
    console.log(`  ${skill.name}: ~${tokens} tokens${refNote}`);
  }
  let missing = allSkillNames.filter(
    (n) => !allSkills.find((s) => s.name === n),
  );
  if (missing.length > 0) {
    console.log(`  Not found: [${missing.join(', ')}]`);
  }
  console.log(
    `  Total: ~${grandTotal} tokens across ${allSkills.length} skills`,
  );

  console.log('\nSmoke test passed.');
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
