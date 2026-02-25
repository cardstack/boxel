import { contains, field } from '@cardstack/base/card-api';
import DatetimeField from '@cardstack/base/datetime';

import { Post } from './post';

export class Article extends Post {
  @field publishedDate = contains(DatetimeField);
}
