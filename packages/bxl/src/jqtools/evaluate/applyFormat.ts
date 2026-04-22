import { FormatAst } from '../parser/AST.js';
import { JqEvaluateError } from '../errors.js';
import { notDefinedError } from './evaluateErrors.js';
import { toString, Type, typeOf } from './utils/utils.js';

const URI_UNRESERVED = /^[A-Za-z0-9\-._~]$/;

function typeDescription(value: unknown): string {
  return `${typeOf(value)} (${toString(value)})`;
}

function jsonEncode(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded ?? 'null';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

function percentEncode(value: string): string {
  let output = '';
  for (const byte of new TextEncoder().encode(value)) {
    const char = String.fromCharCode(byte);
    if (URI_UNRESERVED.test(char)) {
      output += char;
    } else {
      output += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return output;
}

function percentDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    throw new JqEvaluateError(
      `${typeDescription(value)} is not a valid uri encoding`,
    );
  }
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): string {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (_error) {
    throw new JqEvaluateError(
      `${typeDescription(value)} is not valid base64 data`,
    );
  }
}

function formatTabularValue(
  value: unknown,
  mode: 'csv' | 'tsv',
): string {
  if (typeOf(value) !== Type.array) {
    throw new JqEvaluateError(
      `${typeDescription(value)} cannot be ${mode}-formatted, only array`,
    );
  }

  return (value as unknown[])
    .map((cell) => {
      switch (typeOf(cell)) {
        case Type.null:
          return '';
        case Type.boolean:
          return jsonEncode(cell);
        case Type.number:
          return Number.isNaN(cell) ? '' : jsonEncode(cell);
        case Type.string:
          if (mode === 'csv') {
            return `"${(cell as string).replace(/"/g, '""')}"`;
          }
          return (cell as string)
            .replace(/\\/g, '\\\\')
            .replace(/\t/g, '\\t')
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n');
        default:
          throw new JqEvaluateError(
            `${typeDescription(cell)} is not valid in a ${mode} row`,
          );
      }
    })
    .join(mode === 'csv' ? ',' : '\t');
}

function formatShellValue(value: unknown): string {
  const values = typeOf(value) === Type.array ? (value as unknown[]) : [value];

  return values
    .map((entry) => {
      switch (typeOf(entry)) {
        case Type.null:
        case Type.boolean:
        case Type.number:
          return jsonEncode(entry);
        case Type.string:
          return `'${(entry as string).replace(/'/g, `'\\''`)}'`;
        default:
          throw new JqEvaluateError(
            `${typeDescription(entry)} can not be escaped for shell`,
          );
      }
    })
    .join(' ');
}

function formatterFor(name: string): ((value: unknown) => string) | undefined {
  switch (name.startsWith('@') ? name.slice(1) : name) {
    case 'text':
      return (value) => toString(value);
    case 'json':
      return (value) => jsonEncode(value);
    case 'html':
      return (value) => escapeHtml(toString(value));
    case 'uri':
      return (value) => percentEncode(toString(value));
    case 'urid':
      return (value) => percentDecode(toString(value));
    case 'csv':
      return (value) => formatTabularValue(value, 'csv');
    case 'tsv':
      return (value) => formatTabularValue(value, 'tsv');
    case 'sh':
      return (value) => formatShellValue(value);
    case 'base64':
      return (value) => encodeBase64(toString(value));
    case 'base64d':
      return (value) => decodeBase64(toString(value));
    default:
      return undefined;
  }
}

export function applyNamedFormat(name: string, value: unknown): string {
  const formatter = formatterFor(name);
  if (!formatter) {
    throw new JqEvaluateError(`${name} is not a valid format`);
  }
  return formatter(value);
}

export function applyFormat(format: FormatAst | undefined, value: unknown) {
  if (format === undefined) return toString(value);
  const formatter = formatterFor(format.name);
  if (!formatter) throw notDefinedError(format.name);
  return formatter(value);
}
