const textEncoder = new TextEncoder();

export function validateWriteSize(
  content: string,
  maxSizeBytes: number,
  type: 'card' | 'file',
): void {
  const actualSize = textEncoder.encode(content).length;
  if (actualSize > maxSizeBytes) {
    throw new Error(
      `${type === 'card' ? 'Card' : 'File'} size (${actualSize} bytes) exceeds maximum allowed size (${maxSizeBytes} bytes)`,
    );
  }
}
