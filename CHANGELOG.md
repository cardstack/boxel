# Changelog

## Unreleased

- Add CI Host workflow retry that parses JUnit output, reruns failing modules once when fewer than 1,000 first-pass failures occur, records both run counts in the workflow summary, and skips the rerun while failing the build when at least 1,000 tests break.
- Trim the host test suite for iteration by removing acceptance tests and large integration component/command suites while keeping the workflow's standard test invocation across two shards.
- Disable the remaining general CI and lint workflows so only the host retry pipeline runs during iteration.
- Expand CI host retry logging by publishing rerun decision reasons, failure summaries, and rerun module listings to artifacts and step logs for easier debugging.
