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

This documentation is realm content: the guides, the demos they embed and the [3D room](../../widget-room) are all files in the gallery realm, `packages/choreo-gallery/realm`, so links between them stay inside one realm wherever it is served. Each deploy copies that directory onto the realm's disk, so git is the gallery's source of truth.

To publish a copy to a realm of your own, push the directory from the package:

```sh title="Pushing the Gallery to Your Realm"
pnpm --filter choreo-gallery push <your-realm-url> --delete
```

Then open the realm's gallery card to verify it. Keep account names, realm identifiers, credentials, and private demo URLs out of reusable source and documentation.

The realm carries no copies of `glimmer-motion` or `@cardstack/choreo`: its cards import both packages by name, and the Boxel host serves them. Only the films, which play in documents of their own, carry a built bundle, which the push builds into the realm first.

## Checking Navigation

From the deployed realm, open a guide, follow its next-page link, open the demo it embeds, and enter the [3D gallery](../../widget-room). Reload a guide's URL and repeat the tour's Play, Pause, and Resume actions. These checks catch linking and media failures that a local realm cannot reveal.

---

[← Narration and Overlays](film-audio) · [All guides](README) · [Authoring a Film Graph →](film-graph)
