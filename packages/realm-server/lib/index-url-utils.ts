import { param } from '@cardstack/runtime-common';
import {
  addExplicitParens,
  any,
  every,
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

// The index rows a page's markup is read from. A card claims every candidate
// its page URL expands to, its `.json` source included, so while any live
// instance row matches, only instance rows serve the page; a card whose render
// left no markup gets the generic shell, never its source file's. A `file` row
// serves only the exact URL it is read by (a Markdown file's), and only when no
// card claims the page, so every column the page reads comes from rows of one
// kind.
export function pageRowExpressions(pageURL: URL, alias: string): Expression {
  let candidates = indexURLCandidates(pageURL);
  let exactURL = pageURL.href.replace(/\?.*/, '');
  let instanceRows: Expression[] = [
    [`${alias}.type = 'instance'`],
    indexCandidateExpressions(candidates, alias),
  ];
  let fileRows: Expression[] = [
    [`${alias}.type = 'file'`],
    [
      `regexp_replace(${alias}.url, '^https?://', '') =`,
      param(stripProtocol(exactURL)),
    ],
    [
      `NOT EXISTS (SELECT 1 FROM boxel_index AS claim WHERE claim.type = 'instance' AND claim.is_deleted IS NOT TRUE AND`,
      ...indexCandidateExpressions(candidates, 'claim'),
      `)`,
    ],
  ];
  return addExplicitParens(
    any([every(instanceRows), every(fileRows)]),
  ) as Expression;
}

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
