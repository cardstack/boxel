import { field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { BlogPost } from './blog-post';

export class BilingualBlog extends BlogPost {
  static displayName = 'BilingualBlog';

  @field translation = contains(StringField, {
    description: 'A full translation of the blog post body in French',
  });
}
