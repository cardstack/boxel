// Workspaces as the key pages show them: by name, with the address where the
// name alone doesn't tell one from another, since anyone can name a workspace
// anything.
import type { SelectOption } from '@cardstack/pretui/components/select';

export interface Workspace {
  url: string;
  name: string;
}

// A workspace's address as shown beside or beneath its name: its URL without
// the scheme.
export function addressOf(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

// The choices of a workspace picker (Pret UI's Select, searched by name): each
// workspace by its name, and by its address as well where another workspace
// in the list has the same name.
export function workspaceOptions(workspaces: Workspace[]): SelectOption[] {
  return workspaces.map(({ url, name }) => ({
    value: url,
    label: name,
    meta: workspaces.some((w) => w.url !== url && w.name === name)
      ? addressOf(url)
      : undefined,
  }));
}
