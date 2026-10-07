# Recording and Deployment

A finished recording should show the same result each time it is rendered. A deployed interactive tour should load its code, previews, models, and narration from the destination where viewers will open it.

## Preparing a Recording

Choose the output dimensions and frame rate before reviewing typography or camera framing. For a 1080p YouTube delivery, use a 1920 × 1080 viewport and capture 60 frames per second.

For frame number `n`, request the time `n / 60`. Await the scene's render barrier before capturing that frame. Do not use the amount of wall-clock time spent rendering as the presentation clock.

```ts title="Frame Times for a 60 fps Recorder"
const fps = 60;
const duration = 45;
const frameCount = duration * fps;

for (let frame = 0; frame < frameCount; frame++) {
  const time = frame / fps;
  // Await the host's renderAt(time), then capture its completed frame.
}
```

This illustrates the sampling schedule. The recorder still supplies frame capture, audio mixing, and encoding. `choreo-player` supplies time control rather than an MP4 encoder.

## Reviewing the Result

Watch the encoded file, not only the interactive preview. Inspect transitions into live exhibits, text at camera stops, model loading, and the final frame. Compare audio timing at both the beginning and end to catch drift.

For browser delivery, verify the chosen video and audio encoding in Safari. Check that the host serves the correct media content type and supports byte-range requests for seeking.

## Deploying the Site and Gallery

This documentation is part of the gallery application. Build it with the same asset base and routing mode as the rest of the site so links between guides, examples, and the 3D room remain on the same deployment.

```sh title="A Build for a Subdirectory Host"
APP_BASE=./ APP_LOCATION=hash pnpm --filter test-app build
```

For a Boxel host, upload the built application and its supporting assets to a realm you control. Use relative asset paths, publish the realm through your configured environment, and open the published entry document to verify it. Keep account names, realm identifiers, credentials, and private demo URLs out of reusable source and documentation.

The built application carries its own copies of `glimmer-motion` and `@cardstack/choreo`, so a site deployment uploads its static files and media together. Cards written directly in a realm instead import both packages by name from the Boxel host.

## Checking Navigation

From the deployed entry, open a guide, follow its next-page link, visit an example, and enter the [3D gallery](/_widgets). Reload a nested guide URL and repeat the tour's Play, Pause, and Resume actions. These checks catch routing and media failures that a local build cannot reveal.
