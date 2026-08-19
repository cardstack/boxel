import {
  findSearchMarker,
  findSeparatorMarker,
  findReplaceMarker,
  stripTrailingSeparatorMarker,
} from '@cardstack/runtime-common';

export {
  isCompleteSearchReplaceBlock,
  stripTrailingSeparatorMarker,
} from '@cardstack/runtime-common';

interface SearchReplaceResult {
  searchContent: string;
  replaceContent: string | null;
}

/**
 * Parses a string containing search and replace content in a specific format.
 * It tries to detect the search and replace content even if the markers are missing or incomplete.
 *
 * The format is:
 * ╔═══ SEARCH ════╗
 * code to search
 * ╠═══════════════╣
 * code to replace
 * ╚═══ REPLACE ═══╝
 *
 * @param input - The input string to parse
 * @returns An object containing searchContent and replaceContent, even if  the search/replace markers are missing or incomplete
 */

export function parseSearchReplace(input: string): SearchReplaceResult {
  // Initialize result object
  const result: SearchReplaceResult = {
    searchContent: '',
    replaceContent: null,
  };

  // Find the start of search content
  const search = findSearchMarker(input);
  if (!search) {
    // If search marker not found, return empty result
    return result;
  }

  // Find the separator between search and replace content
  const separator = findSeparatorMarker(input, search.end);

  // Find the end of replace content
  const replace = findReplaceMarker(
    input,
    separator ? separator.end : search.end,
  );

  // Extract search content
  const searchContentStart = search.end;
  const searchContentEnd = separator ? separator.index : input.length;

  // Handle the search content
  if (searchContentStart < searchContentEnd) {
    let content = input.substring(searchContentStart, searchContentEnd);

    // Skip exactly one newline if it's the first character and not followed by another newline
    if (content.startsWith('\n') && !content.startsWith('\n\n')) {
      content = content.substring(1);
    }

    content = content.trimEnd();

    result.searchContent = content;
  }

  // Extract replace content if separator exists
  if (separator) {
    const replaceContentStart = separator.end;
    const replaceContentEnd = replace ? replace.index : input.length;

    if (replaceContentStart < replaceContentEnd) {
      let content = input.substring(replaceContentStart, replaceContentEnd);

      // Skip exactly one newline if it's the first character and not followed by another newline
      if (content.startsWith('\n') && !content.startsWith('\n\n')) {
        content = content.substring(1);
      }

      content = stripTrailingSeparatorMarker(content).trimEnd();

      result.replaceContent = content;
    } else {
      result.replaceContent = null; // Empty string for empty replace content
    }
  }

  return result;
}
