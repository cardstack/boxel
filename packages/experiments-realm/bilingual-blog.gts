import {
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { BlogPost } from './blog-post';
import Langugages from '@cardstack/boxel-icons/languages';

export class BilingualBlog extends BlogPost {
  static displayName = 'BilingualBlog';
  static icon = Langugages;

  @field translation = contains(StringField, {
    description: 'A full translation of the blog post body in French',
  });
}
