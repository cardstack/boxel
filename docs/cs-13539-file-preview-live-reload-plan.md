# File previews that load bytes by URL follow writes to their file

## Goal

A file open in the host (an interact stack, where the preview stays mounted
while the store reloads the FileDef) shows the file's current bytes after any
write, for every family whose preview loads the bytes by URL: images, audio,
video, PDF, 3D models, and fonts.

## Problem

A write leaves the file's URL unchanged and gives the FileDef a new
`contentHash` and `lastModified`. A native element bound to the bare URL
(`<img src>`, `<audio src>`) never re-requests it, and the browser's image cache
serves a repeated image URL from memory (realm images are also served with
`max-age=60`).

Confirmed in an interact stack before the change:

- Image preview: stale — the `<img>` keeps the first picture.
- Audio preview: stale — the `<audio>` keeps the first track.
- Video preview, PDF viewer, 3D viewer: already follow writes. Their fetch
  modifiers read the URL through the model, so a FileDef reload dirties the
  argument and reruns the fetch even though the URL string is unchanged.
- Font specimen: already follows writes for files hashed whole; keys on
  `contentHash` alone, so a mid-file edit to a font over the whole-content hash
  limit would not reload.

## Approach

- `file-formats/file-revision.ts`: `fileContentRevision(file)` joins
  `contentHash` and `lastModified` (the hash alone samples files over its
  whole-content limit), and `urlAtRevision(url, revision)` appends it as a
  `rev` query parameter. The realm resolves files by path and ignores the
  query; the auth service worker matches realm URLs by prefix.
- The view model's `imageUrl` (for an image) and `mediaUrl` carry the revision;
  `url`/`resourceUrl` stay clean for links, downloads and copy-link.
- `FileImage`/`FileAudio`/`FileVideo`/`FileObject` load `fileElementURL`: a URL
  resolved from `@file` carries the revision; an explicit URL passes through.
  `FileResource` keeps yielding the clean URL.
- PDF and 3D fetch modifiers take the revision as an explicit argument, so the
  refetch doesn't depend on incidental tag invalidation; the PDF's plain-URL
  fallback carries the revision.
- Font specimen keys its face family and face URL on the revision.
- `HtmlPreview` uses the shared helper.

## Target files

- `packages/base/file-formats/file-revision.ts` (new; registered in
  `packages/host/app/lib/bundled-base.ts`)
- `packages/base/file-formats/{file-image,file-resources,file-view-model,html-preview,pdf-viewer,model3d-preview,font-specimen}.gts|ts`
- `packages/base/file-formats/index.ts`

## Testing

- `Acceptance | interact submode | file preview live reload`: one test per
  family — image (intrinsic width), audio (duration), video and PDF (the bytes
  behind the element's blob URL), 3D (dimensions readout), font (the face the
  specimen asks the browser for).
- `Integration | FileDef resource primitives`: `fileElementURL` and the
  primitives' revisioned URL vs. `FileResource`'s clean one.
- Existing image/audio/PDF/font/HTML def suites and the content-only preview
  components pass unchanged, apart from the new-tab image test matching the
  revisioned `src`.
