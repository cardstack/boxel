import { contains, field } from 'https://cardstack.com/base/card-api';
import DatetimeCard from 'https://cardstack.com/base/datetime';

import { Post } from './post';

export class Article extends Post {
  @field publishedDate = contains(DatetimeCard);
}
