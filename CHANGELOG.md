# Changelog

## Unreleased

- Add CI Host workflow retry that parses JUnit output, reruns failing modules once when fewer than 100 first-pass failures occur, records both run counts in the workflow summary, and skips the rerun while failing the build when at least 100 tests break.
- Adjust the CI Host workflow to execute a focused two-shard smoke subset so iteration on the flaky-retry logic runs faster.
- Disable the remaining general CI and lint workflows so only the host retry pipeline runs during iteration.
