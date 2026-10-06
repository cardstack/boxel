// Pretui — FeatureVoting usage page.
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { Button } from './button';
import { FeatureVoting } from './feature-voting';
import type { FeatureVote } from './feature-voting';
import { FreestyleUsage } from './freestyle-usage';

// ── FeatureVoting ────────────────────────────────────────────────────────

const SEED_VOTES: FeatureVote[] = [
  {
    id: 'f1',
    title: 'Bulk export a catalogue',
    description: 'One CSV per auction, with the netted prices already applied.',
    votes: 42,
    voted: true,
    tag: 'sourcing',
  },
  {
    id: 'f2',
    title: 'Freight quotes inline',
    description: 'Show the live Colombo quote beside every landed price.',
    votes: 31,
    tag: 'pricing',
  },
  {
    id: 'f3',
    title: 'Cupping-sheet OCR',
    description: 'Read a scanned sheet straight into a lot card.',
    votes: 18,
  },
  {
    id: 'f4',
    title: 'Shared bid worksheets',
    description: 'Two buyers on one worksheet, with the receipts merged.',
    votes: 7,
    tag: 'collab',
  },
];

const VOTE_SORTS = ['votes', 'given'];

class FeatureVotingUsage extends GlimmerComponent {
  @tracked features: FeatureVote[] = SEED_VOTES;
  @tracked sort = 'votes';

  setSort = (sort: string) => (this.sort = sort);

  get sortValue(): 'votes' | 'given' {
    return this.sort === 'given' ? 'given' : 'votes';
  }

  vote = (feature: FeatureVote, voted: boolean) => {
    this.features = this.features.map((f) =>
      f.id === feature.id
        ? { ...f, voted, votes: f.votes + (voted ? 1 : -1) }
        : f,
    );
  };
  reset = () => (this.features = SEED_VOTES);

  <template>
    <FreestyleUsage
      @name='FeatureVoting'
      @description='A tally block: what should be built next, and how many people said so. The vote control is a toggle rather than a fire-and-forget button, so it carries aria-pressed and its accessible name states both the subject and the count ("Upvote Bulk export, 42 votes"). Upstream renders the same control as a coloured div — a screen-reader user cannot tell they have voted, and neither can a greyscale reader. Here the pressed state has a filled chevron, a weight change and a ring, and colour is the fourth signal rather than the only one. The share bar is proportional to the LEADING option, not the total, so a ballot with one runaway favourite still shows shape; it is aria-hidden, because the number beside it is the datum. Sorting is deterministic — tally descending, then title — so the same ballot always renders in the same order.'
    >
      <:example>
        <FeatureVoting
          @features={{this.features}}
          @description='One vote each. Votes are public to your workspace.'
          @sort={{this.sortValue}}
          @onVote={{this.vote}}
        />
        <Button
          @tone='neutral'
          @appearance='outlined'
          @size='s'
          {{on 'click' this.reset}}
        >Reset</Button>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='features'
          @description='{ id, title, description?, votes, voted?, tag? }. The tally is the caller’s number — the component never increments it, because the number lives on a server and a component that guessed it would be lying between the click and the response.'
          @value={{this.features}}
        />
        <Args.String
          @name='sort'
          @description='"votes" (default) sorts by tally, highest first, with the title as a stable tiebreak; "given" keeps the caller’s order for a ballot that is already ranked.'
          @value={{this.sort}}
          @options={{VOTE_SORTS}}
          @onInput={{this.setSort}}
          @defaultValue='votes'
        />
        <Args.Base
          @name='onVote'
          @description='Receives the feature and the state the reader is ASKING for — not a toggle instruction — so an optimistic caller and a server-confirmed caller write the same handler.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='title / description / emptyMessage'
          @description='The heading pair and what an empty ballot says.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_FEATURE_VOTING: Record<string, unknown> = {
  FeatureVoting: FeatureVotingUsage,
};
