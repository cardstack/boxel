// A vector's space: the exact vectorizer (id and revision), the provider
// that serves it, and the size. Two vectors compare only within one space,
// so every stored vector records the full string, and a search refuses to
// compare across spaces (`vector-space-mismatch`).
//
//   'qwen/qwen3-embedding-8b@2026-11-05 openrouter:deepinfra 1024'
//
// A plain `VectorField` names no vectorizer; its space is just its size
// ('vector 1024'), comparable only with other plain vectors of that size. A
// type from before spaces were declared in full, which names only an
// `embeddingModel`, reads as 'legacy:<model> <size>' until it is ported.

export interface VectorSpaceSource {
  vectorizer?: string;
  provider?: string;
  dimensions?: number;
  embeddingModel?: string;
}

export function isExactSpace(type: VectorSpaceSource): boolean {
  return (
    typeof type.vectorizer === 'string' &&
    /^[^\s@]+@[^\s@]+$/.test(type.vectorizer) &&
    !/@latest$/i.test(type.vectorizer) &&
    typeof type.provider === 'string' &&
    /^\S+$/.test(type.provider) &&
    Number.isInteger(type.dimensions) &&
    (type.dimensions as number) > 0
  );
}

export function vectorSpace(type: VectorSpaceSource): string {
  let dims = type.dimensions ?? 0;
  if (isExactSpace(type)) {
    return `${type.vectorizer} ${type.provider} ${dims}`;
  }
  if (typeof type.embeddingModel === 'string' && type.embeddingModel) {
    return `legacy:${type.embeddingModel} ${dims}`;
  }
  return `vector ${dims}`;
}

// The size a space string names (its last word).
export function spaceDimensions(space: string): number | undefined {
  let n = Number(space.split(' ').pop());
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
