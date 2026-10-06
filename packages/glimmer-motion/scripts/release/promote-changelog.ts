#!/usr/bin/env node
/**
 * Close out every lockstep package's CHANGELOG `[Unreleased]` section under the
 * shared version heading.
 *
 *   node scripts/release/promote-changelog.ts 0.6.0 2026-08-18
 *
 * Run when a stable release is cut. What was unreleased becomes the record of
 * that version, a fresh `[Unreleased]` opens above it, and the combined notes
 * (one section per package) are written to `$CHANGELOG_NOTES_FILE` (when set)
 * for the GitHub release.
 *
 * The date is an argument rather than read from the clock, so the same inputs
 * always produce the same files.
 *
 *   node scripts/release/promote-changelog.ts --notes 0.6.0
 *
 * Writes the combined notes of a version the CHANGELOGs already record, for a
 * release whose close-out commit landed but whose publish has to be resumed.
 * Edits nothing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGES, REPO_ROOT } from './compute-release.ts';

const UNRELEASED_HEADING = '## [Unreleased]';
const VERSION_HEADING = /^## \[/m;

export interface PromotedChangelog {
  changelog: string;
  notes: string;
}

/**
 * The body of the `[Unreleased]` section, and where it starts and ends.
 */
function unreleasedSection(changelog: string): {
  bodyEnd: number;
  notes: string;
  start: number;
} {
  const start = changelog.indexOf(UNRELEASED_HEADING);
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no "${UNRELEASED_HEADING}" heading`);
  }
  const bodyStart = start + UNRELEASED_HEADING.length;

  // The next version heading bounds the section; without one, everything to the
  // end of the file is unreleased.
  const rest = changelog.slice(bodyStart);
  const nextHeading = rest.search(VERSION_HEADING);
  const bodyEnd =
    nextHeading === -1 ? changelog.length : bodyStart + nextHeading;

  return { bodyEnd, notes: changelog.slice(bodyStart, bodyEnd).trim(), start };
}

/**
 * Move everything under `[Unreleased]` beneath a heading for `version`. A
 * section with nothing in it records `emptyNote` instead, so every version
 * heading says something.
 */
export function promoteUnreleased(
  changelog: string,
  version: string,
  date: string,
  emptyNote: string,
): PromotedChangelog {
  const { bodyEnd, notes: written, start } = unreleasedSection(changelog);
  const notes = written === '' ? emptyNote : written;
  const promoted =
    `${UNRELEASED_HEADING}\n\n## [${version}] — ${date}\n\n${notes}\n\n` +
    changelog.slice(bodyEnd);
  return { changelog: changelog.slice(0, start) + promoted, notes };
}

/**
 * Close out every package's changelog under `version`.
 *
 * The lockstep releases a package whose own section is empty whenever the
 * other one changed, so an empty section gets a line saying so. Every section
 * empty fails instead: a stable release that records no changes anywhere is a
 * gap in the log, and the fix is to write the entries, which no automation can
 * do.
 */
export function promoteAll(
  changelogs: { changelog: string; name: string }[],
  version: string,
  date: string,
): { changelogs: string[]; notes: string } {
  if (
    changelogs.every(({ changelog }) => !unreleasedSection(changelog).notes)
  ) {
    throw new Error(
      `Every CHANGELOG.md's ${UNRELEASED_HEADING} section is empty — write ` +
        `the entries for ${version} before cutting the release`,
    );
  }
  const promoted = changelogs.map(({ changelog, name }) => {
    const others = changelogs
      .filter((other) => other.name !== name)
      .map((other) => `\`${other.name}\``)
      .join(', ');
    return {
      name,
      ...promoteUnreleased(
        changelog,
        version,
        date,
        `No changes of its own; released at this version in lockstep with ${others}.`,
      ),
    };
  });
  return {
    changelogs: promoted.map(({ changelog }) => changelog),
    notes: combinedNotes(promoted),
  };
}

/** The release notes: each package's section under its name, in publish order. */
function combinedNotes(sections: { name: string; notes: string }[]): string {
  return sections
    .map(({ name, notes }) => `## ${name}\n\n${notes}`)
    .join('\n\n');
}

/**
 * The body of the section a changelog records for `version`. Missing or empty
 * fails: a close-out always writes one, so its absence means the changelog
 * doesn't belong to this release.
 */
export function releasedNotes(changelog: string, version: string): string {
  const heading = `## [${version}]`;
  const start = changelog.indexOf(`\n${heading} `);
  if (start === -1) {
    throw new Error(`CHANGELOG.md records no "${heading}" section`);
  }
  const bodyStart = changelog.indexOf('\n', start + 1);
  const rest = changelog.slice(bodyStart);
  const nextHeading = rest.search(VERSION_HEADING);
  const notes = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  if (notes === '') {
    throw new Error(`CHANGELOG.md's "${heading}" section is empty`);
  }
  return notes;
}

/** The combined notes every package's changelog records for `version`. */
export function releasedNotesAll(
  changelogs: { changelog: string; name: string }[],
  version: string,
): string {
  return combinedNotes(
    changelogs.map(({ changelog, name }) => ({
      name,
      notes: releasedNotes(changelog, version),
    })),
  );
}

function writeNotes(notes: string): void {
  const notesFile = process.env.CHANGELOG_NOTES_FILE;
  if (notesFile) {
    writeFileSync(notesFile, `${notes}\n`, 'utf8');
  }
}

if (import.meta.main) {
  const usage =
    'usage: node scripts/release/promote-changelog.ts <version> <date>\n' +
    '       node scripts/release/promote-changelog.ts --notes <version>';
  const paths = PACKAGES.map((pkg) => join(REPO_ROOT, pkg.dir, 'CHANGELOG.md'));
  const read = () =>
    PACKAGES.map((pkg, index) => ({
      changelog: readFileSync(paths[index], 'utf8'),
      name: pkg.name,
    }));
  const args = process.argv.slice(2);
  if (args[0] === '--notes') {
    const version = args[1];
    if (!version) {
      throw new Error(usage);
    }
    writeNotes(releasedNotesAll(read(), version));
    console.log(`release notes ← CHANGELOG.md × ${paths.length} [${version}]`);
  } else {
    const [version, date] = args;
    if (!version || !date) {
      throw new Error(usage);
    }
    const { changelogs, notes } = promoteAll(read(), version, date);
    paths.forEach((path, index) =>
      writeFileSync(path, changelogs[index], 'utf8'),
    );
    writeNotes(notes);
    console.log(`CHANGELOG.md × ${paths.length} → [${version}] — ${date}`);
  }
}
