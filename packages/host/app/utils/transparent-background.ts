import 'jimp';

export async function hasTransparentBackground(
  imageURL: string,
): Promise<boolean> {
  try {
    // @ts-ignore Jimp is exported as a global variable
    let image = await Jimp.read(imageURL);
    return image.hasAlpha();
  } catch (e) {
    console.error('failed to check image background', e);
    return false;
  }
}
