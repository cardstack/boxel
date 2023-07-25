import { isCardTypeFilter, isEveryFilter, type Filter } from './query';

interface ChooseCardSuggestion {
  suggestion: string; // suggests a UI text
  depth: number;
}
export function suggestCardChooserTitle(
  filter: Filter,
  depth: number = 0 //lower the depth, higher the priority
): ChooseCardSuggestion[] {
  let MAX_RECURSION_DEPTH = 3;
  if (filter === undefined || depth > MAX_RECURSION_DEPTH) {
    return [];
  }
  let suggestions: ChooseCardSuggestion[] = [];
  //--base case--
  if ('on' in filter && filter.on !== undefined) {
    let cardRefName = (filter.on as { module: string; name: string }).name;
    return [{ suggestion: `Choose a ${cardRefName} card`, depth }];
  }
  if (isCardTypeFilter(filter)) {
    let cardRefName = (filter.type as { module: string; name: string }).name;
    if (cardRefName == 'Card') {
      suggestions.push({
        suggestion: `Choose a ${cardRefName} instance`,
        depth,
      });
    } else {
      suggestions.push({ suggestion: `Choose a ${cardRefName} card`, depth });
    }
  }
  //--inductive case--
  if (isEveryFilter(filter)) {
    let nestedSuggestions = filter.every.flatMap((f) =>
      suggestCardChooserTitle(f, depth + 1)
    );
    suggestions = [...suggestions, ...nestedSuggestions];
  }
  return suggestions;
}

export function getSuggestionWithLowestDepth(
  items: ChooseCardSuggestion[]
): string | undefined {
  items.sort((a, b) => a.depth - b.depth);
  return items[0]?.suggestion;
}
