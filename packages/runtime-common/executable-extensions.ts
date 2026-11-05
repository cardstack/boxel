import type { RealmResourceIdentifier } from './realm-identifiers.ts';

// This module imports nothing but a type from `realm-identifiers.ts`, itself
// import-free, so a dependency-light consumer (boxel-cli) can import it. Keep
// it that way.

// The extensions the realm serves as compiled modules rather than as stored
// content. Declared in a leaf rather than in the barrel: modules low in the
// import graph read it while their own body runs, and reaching the barrel
// from one of them is a cycle — `index.ts` re-exports them, so a const
// declared there is still in temporal dead zone at that point.
export const executableExtensions = ['.js', '.gjs', '.ts', '.gts'];

// Trimming preserves the form of what it is given: an identifier stays an
// identifier, and a plain string — a URL href, say — stays a plain string
// rather than acquiring a brand it does not warrant.
export function trimExecutableExtension(
  input: RealmResourceIdentifier,
): RealmResourceIdentifier;
export function trimExecutableExtension(input: string): string;
export function trimExecutableExtension(input: string): string {
  for (let extension of executableExtensions) {
    if (input.endsWith(extension)) {
      return input.replace(new RegExp(`\\${extension}$`), '');
    }
  }
  return input;
}
