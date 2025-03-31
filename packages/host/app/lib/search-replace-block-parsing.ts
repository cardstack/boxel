interface SearchReplaceResult {
  searchContent: string;
  replaceContent: string | null;
}

/**
 * Parses a string containing search and replace content in a specific format.
 * It tries to detect the search and replace content even if the markers are missing or incomplete.
 *
 * The format is:
 * <<<<<<< SEARCH
 * code to search
 * =======
 * code to replace
 * >>>>>>> REPLACE
 *
 * @param input - The input string to parse
 * @returns An object containing searchContent and replaceContent, even if  the search/replace markers are missing or incomplete
 */

function parseSearchReplace(input: string): SearchReplaceResult {
  // Define constants for marker texts
  const SEARCH_MARKER: string = '<<<<<<< SEARCH';
  const SEPARATOR_MARKER: string = '=======';
  const REPLACE_MARKER: string = '>>>>>>> REPLACE';

  // Initialize result object
  const result: SearchReplaceResult = {
    searchContent: '',
    replaceContent: null,
  };

  // Find the start of search content
  const searchStart: number = input.indexOf(SEARCH_MARKER);
  if (searchStart === -1) {
    // If search marker not found, return empty result
    return result;
  }

  // Find the separator between search and replace content
  const separator: number = input.indexOf(SEPARATOR_MARKER, searchStart);

  // Find the end of replace content
  const replaceEnd: number = input.indexOf(
    REPLACE_MARKER,
    separator > -1 ? separator : searchStart,
  );

  // Extract search content
  const searchContentStart = searchStart + SEARCH_MARKER.length;
  const searchContentEnd = separator > -1 ? separator : input.length;

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
  if (separator > -1) {
    const replaceContentStart = separator + SEPARATOR_MARKER.length;
    const replaceContentEnd = replaceEnd > -1 ? replaceEnd : input.length;

    if (replaceContentStart < replaceContentEnd) {
      let content = input.substring(replaceContentStart, replaceContentEnd);

      // Skip exactly one newline if it's the first character and not followed by another newline
      if (content.startsWith('\n') && !content.startsWith('\n\n')) {
        content = content.substring(1);
      }

      content = content.trimEnd();

      result.replaceContent = content;
    } else {
      result.replaceContent = null; // Empty string for empty replace content
    }
  }

  return result;
}

export { parseSearchReplace, SearchReplaceResult };
