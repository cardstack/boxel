import FacebookIcon from '@cardstack/boxel-icons/brand-facebook';
import LinkedinIcon from '@cardstack/boxel-icons/brand-linkedin';
import Link from '@cardstack/boxel-icons/link';
import XIcon from '@cardstack/boxel-icons/brand-x';
import { ContactLinkField, type ContactLink } from './contact-link';

export class SocialMediaLinkField extends ContactLinkField {
  static displayName = 'Social Media Link';
  static values: ContactLink[] = [
    {
      type: 'social',
      label: 'X',
      icon: XIcon,
      cta: 'Follow',
    },
    {
      type: 'social',
      label: 'LinkedIn',
      icon: LinkedinIcon,
      cta: 'Connect',
    },
    {
      type: 'social',
      label: 'Facebook',
      icon: FacebookIcon,
      cta: 'Follow',
    },
    {
      type: 'link',
      label: 'Other',
      icon: Link,
      cta: 'Contact',
    },
  ];
}
