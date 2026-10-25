# Changelog

## 1.2.0 - 2026-10-25

- Added Excel (.xlsx) delivery summary export with 11 columns:
  index, company, position, salary, city, company size, education,
  application date, status, result note and job link.
- The CLI asks for the save location before writing. Interactive runs prompt;
  non-interactive runs must pass `--excel <path>` or `--output <path>`,
  otherwise nothing is written.
- Added dependency-free XLSX writer and standalone `export-excel.mjs`.
- `apply-jobs.mjs` now records `attemptedAt` and `education` per job.
- Status mapping covers verified/unconfirmed sends, already-contacted,
  external-only, errors, dry-run and skipped reasons.
- Added Node and Python regression tests, including a real openpyxl read test.

### Validation scope

Tested with synthetic progress data and a local headless browser fixture.
No live recruiter messages were sent during testing. Excel export reads only the
local progress JSON; it does not read cookies, credentials or chat contents.
