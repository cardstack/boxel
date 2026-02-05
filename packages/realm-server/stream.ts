import type { Readable } from 'stream';

export async function nodeStreamToText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  // the types for Readable have not caught up to the fact these are async generators
  for await (const chunk of stream as any) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function nodeStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as any) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
