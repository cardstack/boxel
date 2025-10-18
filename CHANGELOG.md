# Changelog

## Unreleased

- Add CI Host workflow retry that parses JUnit output, reruns failing modules once when fewer than 100 first-pass failures occur, records both run counts in the workflow summary, and skips the rerun while failing the build when at least 100 tests break.
