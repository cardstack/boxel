import { hashWorkspaceBytes } from '../../src/lib/deck-workspace-state.ts';

export interface FakeDeckOperation {
  path: string;
  sha256: string | null;
  contentBase64?: string;
  base?: string | null;
}

export interface FakeDeckUpdate {
  expected: { refGeneration: number };
  operations: FakeDeckOperation[];
}

// The realm server's admission rule for a branch update, over a fake realm's
// content: a per-file update (every operation names its base) is refused only
// for files whose current bytes are neither its base nor its result; any
// other update needs the whole branch unmoved. Returns the 409 to send, or
// undefined when the update may apply.
export function refuseDeckUpdate(
  content: Record<string, string>,
  refGeneration: number,
  update: FakeDeckUpdate,
): Response | undefined {
  if (update.operations.every((operation) => 'base' in operation)) {
    let conflicts = update.operations
      .filter(({ path, sha256, base }) => {
        let now =
          content[path] === undefined
            ? null
            : hashWorkspaceBytes(content[path]);
        return now !== sha256 && now !== base;
      })
      .map(({ path }) => path);
    return conflicts.length > 0
      ? new Response(JSON.stringify({ conflicts }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        })
      : undefined;
  }
  return update.expected.refGeneration === refGeneration
    ? undefined
    : new Response('moved', { status: 409 });
}

export function applyDeckUpdate(
  content: Record<string, string>,
  update: FakeDeckUpdate,
): void {
  for (let operation of update.operations) {
    if (operation.sha256 === null) delete content[operation.path];
    else {
      content[operation.path] = Buffer.from(
        operation.contentBase64!,
        'base64',
      ).toString();
    }
  }
}
