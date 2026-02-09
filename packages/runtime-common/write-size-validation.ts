const textEncoder = new TextEncoder();

export function validateWriteSize(
  content: string | Uint8Array,
  maxSizeBytes: number,
  type: 'card' | 'file',
): void {
  const actualSize =
    content instanceof Uint8Array
      ? content.length
      : textEncoder.encode(content).length;
  if (actualSize > maxSizeBytes) {
    throw new Error(
      `${type === 'card' ? 'Card' : 'File'} size (${actualSize} bytes) exceeds maximum allowed size (${maxSizeBytes} bytes)`,
    );
  }
}
