import ChartDotsIcon from '@cardstack/boxel-icons/chart-dots';
import { CardDef, field, contains, containsMany } from './card-api';
import StringField from './string';
import NumberField from './number';
import BooleanField from './boolean';

// One exact vectorizer revision, as the registry describes it. A vector type
// names a vectorizer by `vectorizerId`, and a vector's space is that id,
// the provider and a size this card allows. A card is never edited to point
// at different weights: a new revision is a new card.
export class Vectorizer extends CardDef {
  static displayName = 'Vectorizer';
  static icon = ChartDotsIcon;

  // The exact id with its revision (`qwen/qwen3-embedding-8b@2026-11-05`).
  // Immutable once vectors exist in its space.
  @field vectorizerId = contains(StringField);
  // Where calls go, with a pinned host where it matters
  // (`openrouter:deepinfra`).
  @field provider = contains(StringField);
  // 'text', or 'multimodal' when text and images share one space.
  @field modality = contains(StringField);
  // The sizes a type may declare: the native size, and the smallest a
  // Matryoshka vectorizer can be trimmed to (equal when it can't).
  @field nativeDimensions = contains(NumberField);
  @field minDimensions = contains(NumberField);
  // The sizes vectors already exist at in some realm, for reference.
  @field dimensionsInUse = containsMany(NumberField);
  @field inputLimit = contains(StringField);
  @field imageLimits = contains(StringField);
  @field queryPrefix = contains(StringField);
  @field documentPrefix = contains(StringField);
  @field normalize = contains(BooleanField);
  // 'cosine' unless the card says otherwise.
  @field distance = contains(StringField);
  @field price = contains(StringField);
  // Other ids whose vectors are interchangeable with this one's, backed by a
  // test that their vectors agree.
  @field sameSpaceAs = containsMany(StringField);
  @field dataHandling = contains(StringField);
  @field notes = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Vectorizer) {
      return this.vectorizerId;
    },
  });
}
