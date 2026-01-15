export function validateWriteSize(
  content: string,
  maxSizeBytes: number,
  type: 'card' | 'file',
): void {
  const actualSize = new TextEncoder().encode(content).length;
  if (actualSize > maxSizeBytes) {
    throw new Error(
      `${type === 'card' ? 'Card' : 'File'} size (${actualSize} bytes) exceeds maximum allowed size (${maxSizeBytes} bytes)`,
    );
  }
}
