import { field, contains } from 'https://cardstack.com/base/card-api';
import { BlogPost } from './blog-post';
import { RatingsSummary } from './ratings-summary';

export class Review extends BlogPost {
  static displayName = 'Review';
  @field rating = contains(RatingsSummary);
}
