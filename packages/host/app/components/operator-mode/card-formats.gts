import Metadata from '@cardstack/boxel-icons/clipboard-data';
import Edit from '@cardstack/boxel-icons/pencil';

import {
  Isolated,
  Embedded,
  Fitted,
  Atom,
  Head,
  Markdown,
  Form,
  type Icon,
} from '@cardstack/boxel-ui/icons';

import { formats, type Format } from '@cardstack/runtime-common';
export { Isolated, Embedded, Fitted, Atom, Edit, Head, Markdown, Form };

export type FormatWithIcon = {
  format: Format;
  icon?: Icon | null;
};

export const formatIcons: Partial<Record<Format, Icon>> = {
  isolated: Isolated,
  embedded: Embedded,
  atom: Atom,
  fitted: Fitted,
  edit: Edit,
  form: Form,
  head: Head,
  markdown: Markdown,
  metadata: Metadata,
};

export const formatsWithIcons: FormatWithIcon[] = formats.map((f) => ({
  format: f,
  icon: formatIcons[f] ?? null,
}));
