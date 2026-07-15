import { ImageDef } from 'https://cardstack.com/base/card-api';
import WriteBinaryFileCommand from '@cardstack/boxel-host/tools/write-binary-file';

// PATTERN: generated image bytes -> realm file -> ImageDef link.
//
// Call this from a Command after an image API returns a data URL or base64
// payload. Save the returned ImageDef on your domain card with linksTo(ImageDef).

function extensionForContentType(contentType: string): string {
  let map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  };
  return map[contentType] ?? 'png';
}

function parseImageDataUrl(dataUrl: string) {
  let match = dataUrl.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match) {
    throw new Error('Expected a base64 image data URL.');
  }

  let [, contentType, base64Content] = match;
  return {
    base64Content,
    contentType,
    contentSize: Math.round((base64Content.length * 3) / 4),
    extension: extensionForContentType(contentType),
  };
}

export async function writeGeneratedImageFile(
  commandContext: any,
  realm: string,
  dataUrl: string,
  pathStem = 'GeneratedImages/result',
): Promise<ImageDef> {
  let image = parseImageDataUrl(dataUrl);
  let written = await new WriteBinaryFileCommand(commandContext).execute({
    path: `${pathStem}.${image.extension}`,
    realm,
    base64Content: image.base64Content,
    contentType: image.contentType,
    useNonConflictingFilename: true,
  });

  let fileIdentifier = written?.fileIdentifier;
  if (!fileIdentifier) {
    throw new Error('Image file write completed without a file identifier.');
  }

  return new ImageDef({
    id: fileIdentifier,
    sourceUrl: fileIdentifier,
    url: fileIdentifier,
    name: decodeURIComponent(
      fileIdentifier.split('/').pop() ?? 'generated-image',
    ),
    contentType: image.contentType,
    contentSize: image.contentSize,
  });
}
