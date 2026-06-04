---
name: pr-screenshots
allowed-tools: Read, Grep, Bash, mcp__chrome-devtools__navigate_page, mcp__chrome-devtools__take_screenshot, mcp__chrome-devtools__resize_page
description: Attach a screenshot or preview image to a PR description or comment when there's no direct image-upload path. Commit the image to the branch, reference its commit-SHA-pinned raw URL in the PR body, then strip the file in a followup commit. Use whenever a PR has a visual change (CSS, layout, component rendering) worth showing reviewers, or when asked to add/refresh a preview image on a PR.
---

# PR Screenshots

A GitHub PR body renders images by URL, but an agent has no way to upload an image straight into the PR description. The reliable workaround: commit the image to the branch, reference it by a **commit-SHA-pinned** raw URL, then delete the file in a followup commit. Reviewers keep seeing the image; the merged branch doesn't carry the artifact at HEAD.

Visual changes benefit enormously from a screenshot — reviewers react to the actual rendering instead of imagining it. Don't skip the image and describe it verbally when the change is visual.

## Order of operations (do NOT parallelize — the URL depends on the SHA)

1. **Commit the image** into the branch at an obvious throwaway path:
   - `.pr-images/<slug>/<name>.png` — hidden dir, never touched by the runtime, easy to spot and strip.
   - or `docs/_pr-images/<slug>/<name>.png` if the repo already has a docs dir.
   - Keep it small — crop or resize before committing.
2. **Push the branch** so the blob is reachable.
3. **Capture the SHA of that commit** immediately: `git rev-parse HEAD` (before any followup commits).
4. **Open the PR** (or post the comment) with the body referencing the **SHA-pinned** raw URL:

   ```
   ![preview](https://raw.githubusercontent.com/<owner>/<repo>/<commit-sha>/.pr-images/<slug>/<name>.png)
   ```

5. **Followup commit** `git rm`s the image and pushes. GitHub still serves the blob from the named commit, so the SHA-pinned reference keeps working.

## Critical gotcha: pin to the commit SHA, never the branch

Branch-pinned raw URLs follow HEAD. The moment the cleanup commit `git rm`s the image, a branch-pinned URL **404s** and the image breaks in the PR — GitHub does not auto-resolve a missing branch-pinned URL back to a historical blob.

- ✅ Immutable: `…/<owner>/<repo>/<commit-sha>/.pr-images/…`
- ❌ Follows HEAD, breaks after strip: `…/<owner>/<repo>/<branch>/.pr-images/…`

Relative paths (`./.pr-images/foo.png`) do render in PR bodies, but break when the PR is viewed from a fork or after a rebase. SHA-pinned raw URLs are the durable form.

## Refreshing a preview / multiple images

When a followup materially changes the PR's UI, add a fresh preview rather than letting the original drift. Each new preview is its own commit-with-image → SHA-pinned URL in a **new PR comment** → strip commit. Number the files (`preview.png`, `preview-v2.png`, …) so the history stays legible.

## Generating a preview when the diff doesn't produce one

- Build a self-contained HTML file mirroring the component's CSS at `/tmp/<slug>-preview/preview.html`.
- Drive `mcp__chrome-devtools__navigate_page` to the full `file:///tmp/<slug>-preview/preview.html` URL (triple slash), then `mcp__chrome-devtools__take_screenshot` with `fullPage: true`.
- For complex layouts, take multiple focused screenshots at different viewport sizes, using `mcp__chrome-devtools__resize_page` between them.

## Open-source / privacy

The committed image is **public forever**, even after the cleanup commit removes it from HEAD — the blob lives on in the commit that added it. Never put real production data, user names, or private URLs in a preview. Use synthetic, fake-but-plausible content in the preview HTML.
