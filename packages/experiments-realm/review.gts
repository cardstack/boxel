import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
// import { BlogPost } from './blog-post';
import { RatingsSummary } from './ratings-summary';

export class Review extends CardDef {
  static displayName = 'Review';
  @field rating = contains(RatingsSummary);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article>
        <@fields.rating class='rating' @format='atom' />
      </article>
      <style scoped>
        article {
          height: 100vh;
          padding: 50px;
        }
        .rating {
          display: inline-block;
          background-color: var(--boxel-dark);
          border-radius: 5px;
          color: var(--boxel-yellow);
          padding: var(--boxel-sp-6xs) var(--boxel-sp-xs);
          height: 20px;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-font-xs);
        }
      </style>
    </template>
  };
}
