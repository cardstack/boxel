# The choreo-player reference proof

> From `docs/choreo-player.md` in Choreo's own repository, where the fixture
> lives. It records a measurement made once, and the gate that was planned
> to repeat it for a 1.0 release. Nothing in the Boxel monorepo runs either.

## Reference proof

`videos/playhead-recording` is the installation and render fixture. It:

- builds the real Glimmer gallery application;
- copies the published-shape `choreo-player/hyperframes` module into the
  composition;
- mounts the real Playhead Glimmer component with no added border;
- binds native `hf-seek` to its awaited frame transaction;
- pins HyperFrames 0.8.14 locally; and
- renders 1920×1080, 30fps, with ten workers.

The proof was compared with a same-build one-worker render. FFmpeg measured
54.15 dB average PSNR and 0.999583 SSIM, and found no post-opening frame that
matched the opening frame at any worker boundary.

## 1.0 release gate

Before publishing:

1. Build and run the package contract tests.
2. Run `pnpm pack` and inspect the tarball contents.
3. Install the tarball in the reference fixture.
4. Run the complete interactive Ember suite.
5. Run HyperFrames check and render with one and ten workers.
6. Scan every worker boundary for an opening-frame insertion.

The npm artifact should contain only `dist`, `README.md`, `LICENSE`, and
`package.json`.
