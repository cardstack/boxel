import TextAreaCard from 'https://cardstack.com/base/text-area';
import {
  Card,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import MetadataCard from 'https://cardstack.com/base/metadata';
import { BlogPost } from './blog-post';

export class PublishingPacket extends Card {
  @field blogPost = linksTo(BlogPost);
  @field socialBlurb = contains(TextAreaCard);
  @field _metadata = contains(MetadataCard, {
    computeVia: function (this: PublishingPacket) {
      return {
        title: this.blogPost?.title
          ? `${this.blogPost?.title} Packet`
          : 'Packet',
      };
    },
  });
}
