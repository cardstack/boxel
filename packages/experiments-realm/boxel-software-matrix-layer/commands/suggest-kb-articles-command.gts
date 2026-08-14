import {
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { GetCardCommand } from '@cardstack/boxel-host/commands/get-card';

import { Ticket } from '../ticket';
import { KnowledgeArticle } from '../knowledge-article';

class SuggestInput extends CardDef {
  @field ticket = linksTo(() => Ticket, { searchable: true });
  @field candidates = linksToMany(() => KnowledgeArticle, {
    description:
      'The articles to score. Pass the library; the command picks the top three.',
  });
}

class SuggestResult extends CardDef {
  @field message = contains(StringField);
  @field scores = containsMany(StringField);
  @field suggested = linksToMany(() => KnowledgeArticle);
}

const FLOOR = 15;
const TOP_N = 3;

/**
 * Score the knowledge base against a ticket and link the best matches.
 *
 * Deliberately deterministic keyword overlap rather than a model call. Agents
 * judge these suggestions dozens of times a day; a wrong-but-explainable score
 * survives that scrutiny and a black box does not — and a suggestion panel
 * that goes blank when the AI credits run out is worse than one that is merely
 * approximate.
 *
 * Anything under the floor is dropped rather than padded to three. Three weak
 * suggestions teach an agent to stop reading the panel, and a panel nobody
 * reads is the same as no panel at all.
 */
/**
 * Re-fetch the subject before reading anything through its links.
 *
 * A caller may hand over a card whose linked fields were never loaded — a
 * queue row, a search result, a card that arrived over a command boundary.
 * Reading `ticket.queue?.defaultPolicy` off one of those silently yields
 * `undefined` and the command quietly does the wrong thing rather than
 * failing, which is how a live run produced an ownerless record.
 */
async function loaded(context: any, ticket: any) {
  if (!ticket?.id) {
    return ticket;
  }
  return ((await new GetCardCommand(context).execute({
    cardId: ticket.id,
  } as any)) ?? ticket) as any;
}

export class SuggestKbArticlesCommand extends Command<
  typeof SuggestInput,
  typeof SuggestResult
> {
  static actionVerb = 'Suggest articles';
  static displayName = 'Suggest Knowledge Articles';

  async getInputType() {
    return SuggestInput;
  }

  protected async run(input: SuggestInput): Promise<SuggestResult> {
    let { candidates } = input;
    let ticket = await loaded(this.commandContext, input.ticket);
    if (!ticket) {
      throw new Error('ticket is required');
    }
    let library = (candidates ?? []).filter(Boolean);
    if (!library.length) {
      throw new Error(
        'No candidate articles were passed, so there is nothing to score.',
      );
    }

    let question = [ticket.subject, ticket.details, ...(ticket.tags ?? [])]
      .filter(Boolean)
      .join(' ');

    let ranked = library
      .map((article) => ({ article, score: article.relevanceTo(question) }))
      .filter((entry) => entry.score >= FLOOR)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);

    if (!ranked.length) {
      return new SuggestResult({
        message: `Nothing in the knowledge base matches ${ticket.reference ?? 'this ticket'} well enough to suggest. That gap is itself worth knowing — it is an article somebody should write.`,
        scores: [],
      });
    }

    // ADDITIVE, never a replacement.
    //
    // This used to assign the ranked list straight over `linkedArticles`,
    // which made a command named "suggest" quietly destructive: the sole UI
    // caller passes the ticket's OWN links in as candidates, so re-ranking
    // detached every internal article, everything scoring under the floor,
    // and everything past the top N — articles an agent had attached by hand,
    // gone with no undo and no mention in the result message.
    //
    // Only PUBLIC articles get linked, because a linked article is one an
    // agent may paste to a customer. Internal ones still appear as
    // suggestions in the workspace, where the visibility badge is visible.
    let existing = (ticket.linkedArticles ?? []).filter(Boolean);
    let linked = new Set(existing.map((article: any) => article.id));
    let additions = ranked
      .filter(
        (entry) =>
          entry.article.visibility !== 'Internal' &&
          !linked.has(entry.article.id),
      )
      .map((entry) => entry.article);

    // No save when nothing changed. A write here is a reindex, and a reindex
    // is a visible flicker through every live query watching this ticket.
    if (additions.length) {
      ticket.linkedArticles = [...existing, ...additions];
      await new SaveCardCommand(this.commandContext).execute({ card: ticket });
    }

    return new SuggestResult({
      message: `Top match: ${ranked[0]!.article.title} at ${ranked[0]!.score}%.`,
      scores: ranked.map(
        (entry) =>
          `${entry.score}% — ${entry.article.title}${
            entry.article.visibility === 'Internal' ? ' (internal)' : ''
          }`,
      ),
      suggested: ranked.map((entry) => entry.article),
    });
  }
}
