// The realm server's description of what a key page was opened for
// (`windowContext` in `security/keys.js`).
import type { DestinationDisplay } from './destination.gts';

export interface WindowContext {
  realm: { url: string; name: string; directWriter: boolean };
  card?: { name: string; module: string; exportName: string };
  operation?: {
    name: string;
    label: string;
    base: string;
    method?: string;
    destination?: DestinationDisplay;
    slots: { name: string; key: string }[];
  };
}

export interface UserKey {
  id: string;
  name: string;
  kind: string;
  state: string;
  createdAt: string;
  updatedAt: string;
}

export interface KeyShare {
  id: string;
  realm: string;
  label: string;
  owner: string;
  keyId?: string | null;
  state: 'active' | 'suspended';
  suspensionReason: string | null;
}

// What a refused request says to the user: the server's reason, as a
// sentence.
export function failureMessage(e: unknown): string {
  let message = (e as { message?: unknown })?.message;
  let text =
    typeof message === 'string' && message
      ? message
      : 'Something went wrong. Try again.';
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function isSignedOut(e: unknown): boolean {
  return (e as { code?: unknown })?.code === 'signed-out';
}
