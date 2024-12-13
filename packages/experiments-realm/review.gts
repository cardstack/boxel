import {
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { BlogPost } from './blog-post';
import { RatingsSummary } from './ratings-summary';

// @ts-expect-error using own template
export class Review extends BlogPost {
  static displayName = 'Review';
  @field rating = contains(RatingsSummary);
  @field userRating = contains(RatingsSummary);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article>
        <@fields.rating class='rating' />
        <BlogPost.isolated @model={{@model}} @fields={{@fields}} />

        <div class='rate'>Rate this movie
          <@fields.userRating class='user-rating' /></div>
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
        .rate {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .user-rating :deep(.rating) {
          display: none;
        }
      </style>
    </template>
  };
}
