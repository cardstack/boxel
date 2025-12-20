import ImageCard from 'https://cardstack.com/base/image';
import { contains, field } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';

export const CLOUDFLARE_ACCOUNT_ID = '4a94a1eb2d21bbbe160234438a49f687';

const CLOUDFLARE_VARIANT = 'public';

export class CloudflareImage extends ImageCard {
  static displayName = 'Cloudflare Image';

  @field cloudflareId = contains(StringField);
  @field url = contains(UrlField, {
    computeVia(this: CloudflareImage) {
      if (!this.cloudflareId) {
        return undefined;
      }
      return `https://i.boxel.site/${this.cloudflareId}/${CLOUDFLARE_VARIANT}`;
    },
  });
}
