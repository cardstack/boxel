import a from 'indefinite';

import {
  CodeRef,
  getPlural,
  loadCard,
  Loader,
} from '@cardstack/runtime-common';
import {
  isCardTypeFilter,
  isEveryFilter,
  type Filter,
} from '@cardstack/runtime-common/query';

interface ChooseCardSuggestion {
  suggestion: string; // suggests a UI text
  depth: number;
}

interface Opts {
  loader: Loader;
  multiSelect?: boolean;
}
export async function suggestCardChooserTitle(
  filter: Filter,
  depth = 0, //lower the depth, higher the priority
  opts: Opts,
): Promise<ChooseCardSuggestion[]> {
  let MAX_RECURSION_DEPTH = 2;
  if (filter === undefined || depth + 1 > MAX_RECURSION_DEPTH) {
    return [];
  }
  let suggestions: ChooseCardSuggestion[] = [];
  //--base case--
  if ('on' in filter && filter.on !== undefined) {
    let cardDisplayName = await getCardDisplayName(opts.loader, filter.on);
    return [{ suggestion: titleText(cardDisplayName, 'card', opts), depth }];
  }
  if (isCardTypeFilter(filter)) {
    let cardDisplayName = await getCardDisplayName(opts.loader, filter.type);
    if (cardDisplayName == 'Card') {
      suggestions.push({
        suggestion: titleText('Card', 'instance', opts),
        depth,
      });
    } else {
      suggestions.push({
        suggestion: titleText(cardDisplayName, 'card', opts),
        depth,
      });
    }
  }
  //--inductive case--
  if (isEveryFilter(filter)) {
    let nestedSuggestions = await Promise.all(
      filter.every.map(
        async (f) => await suggestCardChooserTitle(f, depth + 1, opts),
      ),
    ).then((arrays) => arrays.flat());
    suggestions = [...suggestions, ...nestedSuggestions];
  }
  return suggestions;
}

type CardNoun = 'instance' | 'type' | 'card';

function titleText(cardDisplayName: string, cardNoun: CardNoun, opts?: Opts) {
  let object = `${cardDisplayName} ${cardNoun}`;
  if (opts?.multiSelect) {
    return `Select 1 or more ${getPlural(object)}`;
  } else {
    return `Choose ${a(object)}`;
  }
}

async function getCardDisplayName(loader: Loader, codeRef: CodeRef) {
  let card = await loadCard(codeRef, { loader });
  return card.displayName;
}

export function getSuggestionWithLowestDepth(
  items: ChooseCardSuggestion[],
): string | undefined {
  items.sort((a, b) => a.depth - b.depth);
  return items[0]?.suggestion;
}
