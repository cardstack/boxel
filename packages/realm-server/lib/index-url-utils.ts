import { param } from '@cardstack/runtime-common';
import {
  addExplicitParens,
  any,
  type Expression,
} from '@cardstack/runtime-common/expression';

export function stripProtocol(href: string): string {
  return href.replace(/^https?:\/\//, '');
}

export function indexURLCandidates(cardURL: URL): string[] {
  let href = cardURL.href.replace(/\?.*/, '');
  let candidates = [href].flatMap((url) => {
    // strip trailing slash, but keep root realm URLs that end with slash
    let trimmed = url.endsWith('/') ? url.slice(0, -1) : url;
    let withIndex = url.endsWith('/') ? `${trimmed}/index` : `${url}/index`;
    let withJson = `${url.replace(/\/?$/, '')}.json`;
    let withIndexJson = `${withIndex}.json`;
    return [url, trimmed, withIndex, withJson, withIndexJson];
  });

  return [...new Set(candidates)];
}

export function indexCandidateExpressions(candidates: string[]): Expression {
  // Proxying means the apparent request URL will be http but in the database it's https
  return addExplicitParens(
    any(
      candidates.flatMap((candidate) => [
        [
          "regexp_replace(url, '^https?://', '') =",
          param(stripProtocol(candidate)),
        ],
        [
          "regexp_replace(file_alias, '^https?://', '') =",
          param(stripProtocol(candidate)),
        ],
      ]),
    ) as Expression,
  ) as Expression;
}
