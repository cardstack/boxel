## CS-10070 Misaligned spinner plan

### Goals
- Center the Preview panel loading spinner in code submode.
- Avoid regressions in other loading states.

### Assumptions
- The misaligned spinner is the Preview tab loading indicator in the
  code submode module inspector.
- The issue occurs when Preview shows a loading state (e.g. new instance
  creation or field preview updates).

### Steps
1. Update `PlaygroundPanel` to wrap the loading spinner in a centered
   container for all loading branches.
2. Adjust the loading container styles to center the spinner within the
   preview panel.
3. Verify the Preview panel loading state is centered.

### Target files
- `packages/host/app/components/operator-mode/code-submode/playground/playground-panel.gts`

### Testing notes
- Run `pnpm lint` in `packages/host`.
- Manually verify in the UI if possible by triggering a Preview loading state.
