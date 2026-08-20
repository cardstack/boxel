#!/usr/bin/env node
/**
 * Close out the CHANGELOG's `[Unreleased]` section under a version heading.
 *
 *   node scripts/promote-changelog.ts 0.6.0 2026-08-18
 *
 * Run when a stable release is cut. What was unreleased becomes the record of
 * that version, a fresh `[Unreleased]` opens above it, and the section's body
 * is written to `$CHANGELOG_NOTES_FILE` (when set) for the GitHub release.
 *
 * The date is an argument rather than read from the clock, so the same inputs
 * always produce the same file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');

const UNRELEASED_HEADING = '## [Unreleased]';
const VERSION_HEADING = /^## \[/m;

export interface PromotedChangelog {
  changelog: string;
  notes: string;
}

/**
 * Move everything under `[Unreleased]` beneath a heading for `version`.
 *
 * An empty section fails rather than producing a version heading with nothing
 * under it: a stable release that records no changes is a gap in the log, and
 * the fix is to write the entry, which no automation can do.
 */
export function promoteUnreleased(
  changelog: string,
  version: string,
  date: string,
): PromotedChangelog {
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

  const notes = changelog.slice(bodyStart, bodyEnd).trim();
  if (notes === '') {
    throw new Error(
      `CHANGELOG.md's ${UNRELEASED_HEADING} section is empty — write the ` +
        `entry for ${version} before cutting the release`,
    );
  }

  const promoted =
    `${UNRELEASED_HEADING}\n\n## [${version}] — ${date}\n\n${notes}\n\n` +
    changelog.slice(bodyEnd);
  return { changelog: changelog.slice(0, start) + promoted, notes };
}

if (import.meta.main) {
  const [version, date] = process.argv.slice(2);
  if (!version || !date) {
    throw new Error(
      'usage: node scripts/promote-changelog.ts <version> <date>',
    );
  }
  const path = join(PACKAGE_ROOT, 'CHANGELOG.md');
  const { changelog, notes } = promoteUnreleased(
    readFileSync(path, 'utf8'),
    version,
    date,
  );
  writeFileSync(path, changelog, 'utf8');
  const notesFile = process.env.CHANGELOG_NOTES_FILE;
  if (notesFile) {
    writeFileSync(notesFile, `${notes}\n`, 'utf8');
  }
  console.log(
    `CHANGELOG.md → [${version}] — ${date} (${notes.split('\n').length} lines)`,
  );
}
