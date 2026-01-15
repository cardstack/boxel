# CS-10043 plan

## Goals
- Show daily credit grant timestamps in the user's local timezone.
- Keep grant copy and relative time intact.

## Assumptions
- `lastDailyCreditGrantAt` and `nextDailyCreditGrantAt` remain epoch seconds.
- UI should display locale formatting with a timezone abbreviation.

## Steps
1. Update the timestamp formatter in `packages/host/app/components/with-subscription-data.gts` to use the local timezone.
2. Rename formatter and variables for clarity.
3. Verify the daily grant note still renders.

## Target files
- `packages/host/app/components/with-subscription-data.gts`

## Testing
- `pnpm lint` in `packages/host`
