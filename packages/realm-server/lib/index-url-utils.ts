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

// A page URL's candidates can match both a card's instance row and the `file`
// row of its own `.json` source. A page for a card serves the card, so an
// instance row wins; a file row is served only for a URL no card claims, such
// as a Markdown file's.
export const INSTANCE_ROWS_FIRST = `CASE WHEN i.type = 'instance' THEN 0 ELSE 1 END`;

export function indexCandidateExpressions(
  candidates: string[],
  // Table alias to qualify `url` / `file_alias` with. Required when the query
  // joins another table that also carries these columns (e.g. the join to
  // `prerendered_html`), so the references are unambiguous.
  alias?: string,
): Expression {
  let prefix = alias ? `${alias}.` : '';
  // Proxying means the apparent request URL will be http but in the database it's https
  return addExplicitParens(
    any(
      candidates.flatMap((candidate) => [
        [
          `regexp_replace(${prefix}url, '^https?://', '') =`,
          param(stripProtocol(candidate)),
        ],
        [
          `regexp_replace(${prefix}file_alias, '^https?://', '') =`,
          param(stripProtocol(candidate)),
        ],
      ]),
    ) as Expression,
  ) as Expression;
}
