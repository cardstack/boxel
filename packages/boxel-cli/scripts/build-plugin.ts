/**
 * Generate the `<!-- generated:commands -->` synopsis blocks in the plugin's
 * SKILL.md files from the Commander program. Run via `pnpm build:plugin`.
 *
 * CI runs this and `git diff --exit-code` to fail PRs whose CLI changes
 * weren't reflected in the plugin. The "synopsis-bump coupling" check (see
 * .github/workflows/ci-lint.yaml) further ensures `plugin.json` is bumped
 * whenever a generated block changes.
 */
import type { Command, Option } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { buildBoxelProgram } from '../src/build-program';

const PLUGIN_DIR = resolve(__dirname, '..', 'plugin');

interface SkillSpec {
  /** Skill folder name under plugin/skills/ */
  skill: string;
  /** Whitespace-separated command paths to include, in display order. */
  commands: string[];
}

const SKILL_SPECS: SkillSpec[] = [
  {
    skill: 'realm-sync',
    commands: [
      'realm sync',
      'realm watch start',
      'realm watch stop',
      'realm push',
      'realm pull',
      'realm create',
      'realm remove',
      'realm list',
    ],
  },
  {
    skill: 'realm-history',
    commands: [
      'realm history',
      'realm wait-for-ready',
      'realm cancel-indexing',
    ],
  },
  {
    skill: 'file-ops',
    commands: [
      'file read',
      'file write',
      'file list',
      'file delete',
      'file lint',
      'file touch',
    ],
  },
  {
    skill: 'search',
    commands: ['search'],
  },
  {
    skill: 'profile',
    commands: ['profile'],
  },
];

const START_MARKER = '<!-- generated:commands:start -->';
const END_MARKER = '<!-- generated:commands:end -->';

function findCommand(root: Command, path: string[]): Command | undefined {
  let current: Command | undefined = root;
  for (const part of path) {
    if (!current) return undefined;
    current = current.commands.find((c) => c.name() === part);
  }
  return current;
}

function fullCommandLine(cmd: Command, ancestors: string[]): string {
  const args = cmd.registeredArguments
    .map((a) => {
      const name = a.required ? `<${a.name()}>` : `[${a.name()}]`;
      return a.variadic ? `${name}...` : name;
    })
    .join(' ');
  const parts = [...ancestors, cmd.name()];
  return ['boxel', ...parts, args].filter(Boolean).join(' ');
}

function formatCommandBlock(cmd: Command, ancestors: string[]): string {
  const lines: string[] = [];
  lines.push(`### \`${fullCommandLine(cmd, ancestors)}\``);
  lines.push('');
  const desc = cmd.description();
  if (desc) {
    lines.push(desc);
    lines.push('');
  }

  if (cmd.registeredArguments.length > 0) {
    lines.push('**Arguments:**');
    lines.push('');
    for (const arg of cmd.registeredArguments) {
      const ref = arg.required ? `\`<${arg.name()}>\`` : `\`[${arg.name()}]\``;
      const description = arg.description ?? '';
      lines.push(`- ${ref}${description ? ` — ${description}` : ''}`);
    }
    lines.push('');
  }

  // Filter out commander's auto-help option and our global -q/--quiet
  // (documented at the top-level, not per-command).
  const visibleOptions = cmd.options.filter(
    (o: Option) => o.long !== '--help' && o.long !== '--quiet',
  );
  if (visibleOptions.length > 0) {
    lines.push('**Options:**');
    lines.push('');
    for (const opt of visibleOptions) {
      const flags = opt.flags;
      const description = opt.description ?? '';
      lines.push(`- \`${flags}\`${description ? ` — ${description}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateSynopsis(spec: SkillSpec, program: Command): string {
  const blocks: string[] = [
    '## Commands',
    '',
    '_Generated from the boxel-cli Commander tree by_ `pnpm build:plugin`. _Edit prose outside the generated block — never inside it._',
    '',
  ];

  for (const cmdPath of spec.commands) {
    const parts = cmdPath.trim().split(/\s+/);
    const cmd = findCommand(program, parts);
    if (!cmd) {
      throw new Error(
        `Skill "${spec.skill}" references unknown command: \`boxel ${cmdPath}\`. ` +
          `Update SKILL_SPECS in scripts/build-plugin.ts or restore the command in src/.`,
      );
    }
    blocks.push(formatCommandBlock(cmd, parts.slice(0, -1)));
  }

  return blocks.join('\n').trimEnd() + '\n';
}

function rewriteSkillFile(skill: string, body: string): boolean {
  const path = resolve(PLUGIN_DIR, 'skills', skill, 'SKILL.md');
  const original = readFileSync(path, 'utf8');
  const startIdx = original.indexOf(START_MARKER);
  const endIdx = original.indexOf(END_MARKER, startIdx + START_MARKER.length);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Skill ${skill} is missing generated:commands markers. ` +
        `Add ${START_MARKER} and ${END_MARKER} (with a blank line between them) to ${path}.`,
    );
  }
  if (endIdx < startIdx) {
    throw new Error(
      `Skill ${skill}: ${END_MARKER} appears before ${START_MARKER} in ${path}.`,
    );
  }
  const before = original.slice(0, startIdx + START_MARKER.length);
  const after = original.slice(endIdx);
  const updated = `${before}\n\n${body}\n${after}`;
  if (updated === original) return false;
  writeFileSync(path, updated);
  return true;
}

function main(): void {
  const program = buildBoxelProgram('0.0.0');
  let changed = 0;
  for (const spec of SKILL_SPECS) {
    const body = generateSynopsis(spec, program);
    if (rewriteSkillFile(spec.skill, body)) {
      changed++;
      console.log(`updated plugin/skills/${spec.skill}/SKILL.md`);
    }
  }
  console.log(
    changed === 0
      ? 'Plugin synopsis already up to date.'
      : `Plugin synopsis regenerated (${changed} file${changed === 1 ? '' : 's'} changed).`,
  );
}

main();
