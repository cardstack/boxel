import { Readable } from "stream";

export async function streamToText(stream: Readable): Promise<string> {
  if (!(stream instanceof Readable)) {
    throw new Error(`Cannot handle web-stream in node environment`);
  }

  const chunks: Buffer[] = [];
  // the types for Readable have not caught up to the fact these are async generators
  for await (const chunk of stream as any) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
