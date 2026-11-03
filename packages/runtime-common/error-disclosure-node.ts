import path from 'node:path';

const pathDelimiters = new Set([
  ' ',
  '\n',
  '\r',
  '\t',
  '"',
  "'",
  '<',
  '>',
  ')',
  ']',
  ',',
  ';',
]);

export function createErrorDisclosureFromEnv(
  env: Record<string, string | undefined>,
): { redacted: boolean; formatText: (text: string) => string } {
  let mode = env.BOXEL_ERROR_DETAILS ?? 'full';
  let rawPaths = env.BOXEL_ERROR_PRIVATE_PATH_PREFIXES;
  if (mode === 'full') {
    if (rawPaths !== undefined)
      throw new Error('Private error paths require redacted error details');
    return { redacted: false, formatText: (text: string) => text };
  }
  if (mode !== 'redacted' || !rawPaths)
    throw new Error('Invalid error disclosure configuration');
  let input: unknown;
  try {
    input = JSON.parse(rawPaths);
  } catch {
    throw new Error('Invalid private error path configuration');
  }
  if (!Array.isArray(input) || input.length === 0)
    throw new Error('Configure private error paths');
  let privatePaths = input
    .map((prefix: unknown) => {
      if (
        typeof prefix !== 'string' ||
        !path.isAbsolute(prefix) ||
        path.parse(prefix).root === prefix
      ) {
        throw new Error('Private error prefixes must be absolute directories');
      }
      return prefix.endsWith(path.sep) ? prefix.slice(0, -1) : prefix;
    })
    .sort((a, b) => b.length - a.length);

  function redactText(text: string) {
    let result = text
      .split('\n')
      .filter((line) => !/^\s*at\s+.*(?:\(|:\d|node:|file:)/.test(line))
      .join('\n');
    result = result.replace(/file:\/\/[^\s"'<>)]*/gi, '[local file]');
    for (let prefix of privatePaths) {
      let cursor = 0;
      for (;;) {
        let index = result.indexOf(prefix, cursor);
        if (index === -1) break;
        cursor = index + prefix.length;
        if (
          cursor < result.length &&
          ![path.sep, '/', '\\', ':'].includes(result[cursor]) &&
          !pathDelimiters.has(result[cursor])
        )
          continue;
        if (
          index > 0 &&
          !pathDelimiters.has(result[index - 1]) &&
          !['(', ':', '='].includes(result[index - 1])
        )
          continue;
        let end = cursor;
        while (end < result.length && !pathDelimiters.has(result[end])) end++;
        result = `${result.slice(0, index)}[local file]${result.slice(end)}`;
        cursor = index + '[local file]'.length;
      }
    }
    return result;
  }

  return { redacted: true, formatText: redactText };
}
