import window from 'ember-window-mock';

import type { RecentFile } from '@cardstack/host/services/recent-files-service';
import {
  RecentFiles,
  RecentCards,
} from '@cardstack/host/utils/local-storage-keys';

export function getRecentFileURL(recentFile: RecentFile) {
  if (!recentFile) {
    throw new Error(`recent file was not provided`);
  }
  return `${recentFile.realmURL}${recentFile.filePath}`;
}

export function assertRecentFileURLs(
  assert: Assert,
  recentFiles: RecentFile[],
  fileURLs: string[],
  message?: string,
) {
  assert.strictEqual(
    recentFiles.length,
    fileURLs.length,
    'recent file count is correct',
  );
  recentFiles.map((recentFile, i) =>
    assert.strictEqual(
      getRecentFileURL(recentFile),
      fileURLs[i],
      message ?? `url is correct for recent file at index ${i}`,
    ),
  );
}

// direct manipulation of local storage:
type RecentFiles =
  | [string, string][]
  | [string, string, { line: number; column: number } | null, number][];

// RecentFiles
export function getRecentFiles(): RecentFiles | null {
  let files = window.localStorage.getItem(RecentFiles);
  if (!files) {
    return null;
  }
  return JSON.parse(files);
}

export function setRecentFiles(files: RecentFiles) {
  // ensure deterministic ordering when explicit timestamps are not provided
  let baseTimestamp = Date.now() + files.length;
  let recentFiles = files.map(
    ([realmURL, filePath, cursorPosition, timestamp], index) => [
      realmURL,
      filePath,
      cursorPosition ?? null,
      timestamp ?? baseTimestamp - index,
    ],
  );
  window.localStorage.setItem(RecentFiles, JSON.stringify(recentFiles));
}

export function removeRecentFiles() {
  window.localStorage.removeItem(RecentFiles);
}

// RecentCards
export function getRecentCards():
  | { cardId: string; timestamp?: number }[]
  | null {
  let cards = window.localStorage.getItem(RecentCards);
  if (!cards) {
    return null;
  }
  return JSON.parse(cards);
}

export function setRecentCards(cards: ([string, number] | [string])[]) {
  let recentCards = cards.map(([cardId, timestamp]) => ({ cardId, timestamp }));
  window.localStorage.setItem(RecentCards, JSON.stringify(recentCards));
}

export function removeRecentCards() {
  window.localStorage.removeItem(RecentCards);
}
