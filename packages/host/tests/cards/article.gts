import { contains, field } from 'https://cardstack.com/base/card-api';
import DatetimeField from 'https://cardstack.com/base/datetime';

import { Post } from './post';

export class Article extends Post {
  @field publishedDate = contains(DatetimeField);
}
