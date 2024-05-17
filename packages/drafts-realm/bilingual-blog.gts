import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { BlogPost } from './blog-post'

export class BilingualBlog extends BlogPost {
  static displayName = "BilingualBlog";

  @field translation = contains(StringField, {description: "A full translation of the blog post body in French"});
  
  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }
  */
}