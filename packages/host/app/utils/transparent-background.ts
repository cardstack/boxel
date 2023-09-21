import 'jimp';

export async function hasTransparentBackground(
  imageURL: string,
): Promise<boolean> {
  // @ts-ignore Jimp is exported as a global variable
  let image = await Jimp.read(imageURL);
  return image.hasAlpha();
}
