import ImageCard from '@cardstack/base/image';
import { contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import UrlField from '@cardstack/base/url';

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
