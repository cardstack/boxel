import { pauseTest, settled } from '@ember/test-helpers';

import originalPercySnapshot from '@percy/ember';

import QUnit from 'qunit';

const PERCY_PAUSE_PARAMETER = 'percypause';

QUnit.config.urlConfig.push({
  id: PERCY_PAUSE_PARAMETER,
  label: 'Pause on Percy snapshot',
});

export default async function percySnapshot(
  ...args: Parameters<typeof originalPercySnapshot>
) {
  await settled();

  // Adapted from: https://github.com/GoogleForCreators/web-stories-wp/pull/6324/files#diff-970412cd35c9346699038fab952d3c0c9a0e5060a60ed528813def9a00ca157b
  const weights = ['400', '500', '600', '700'];

  // Using 1em lets us avoid needing to specify every size the application uses
  const fontPromises = weights.map((weight) =>
    document.fonts.load(`${weight} 1em IBM Plex Sans`, ''),
  );

  await Promise.all(fontPromises);
  await document.fonts.ready;

  weights.forEach((weight) => {
    const descriptor = `${weight} 1em IBM Plex Sans`;
    if (!document.fonts.check(descriptor, '')) {
      throw new Error(
        `Not ready: IBM Plex Sans font could not be loaded (${descriptor})`,
      );
    }
  });

  if (window.location.search.includes(PERCY_PAUSE_PARAMETER)) {
    await pauseTest();
  }

  await originalPercySnapshot(...args);
}
