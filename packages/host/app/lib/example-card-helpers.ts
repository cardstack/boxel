import { ensureExtension } from '@cardstack/runtime-common';

export const ONE_SHOT_SYSTEM_PROMPT = `You are Boxel's sample data assistant. When given a card definition you return JSON that can seed a new instance.

Rules:
- Always respond with valid JSON.
- Respond with a single JSON object representing the generated example.
- Do not include prose, code fences, or wrapper structures such as arrays.
- Each example should include realistic values for the card's required fields.`;

export function buildExamplePrompt(count = 1, codeRef?: { name?: string }) {
  let lines = [
    count === 1
      ? 'Generate a single additional instance of the specified card definition, populated with sample data.'
      : `Generate ${count} additional instances of the specified card definition, populated with sample data.`,
    'Provide realistic, distinct values so the new instance is unique from existing examples.',
    'Respond ONLY with the JSON object for the example—no prose, code fences, or wrapper structures.',
  ];
  if (codeRef?.name) {
    lines.push(`Card definition name: ${codeRef.name}`);
  }
  return lines.join(' ');
}

export function buildAttachedFileURLs(modulePath?: string) {
  if (!modulePath) {
    return [];
  }
  let cardModuleURL = ensureExtension(modulePath, {
    default: '.gts',
  });
  return cardModuleURL ? [cardModuleURL] : [];
}

export function parseExamplePayloadFromOutput(output?: string | null): {
  payload?: Record<string, unknown>;
} {
  if (!output) {
    return {};
  }
  const jsonString = extractJsonString(output);
  if (!jsonString) {
    return {};
  }
  try {
    const parsed = JSON.parse(jsonString);
    const payload = coerceExamplePayload(parsed);
    if (!payload) {
      return {};
    }
    return { payload };
  } catch (error) {
    console.warn('Failed to parse JSON from LLM output', { error });
    return {};
  }
}

function coerceExamplePayload(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const first = value.find((item) => item && typeof item === 'object');
    return first ? { ...(first as Record<string, unknown>) } : undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.examples)) {
      const first = record.examples.find(
        (item) => item && typeof item === 'object',
      );
      return first ? { ...(first as Record<string, unknown>) } : undefined;
    }
    if (record.example && typeof record.example === 'object') {
      return { ...(record.example as Record<string, unknown>) };
    }
    return { ...record };
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return coerceExamplePayload(parsed);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractJsonString(text: string): string | undefined {
  let start = text.indexOf('{');
  let end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }
  return text.slice(start, end + 1);
}
