# rVacation project plan

## Product scope

rVacation is a desktop app for secretaries to maintain worker records, record vacations, and see the allowance used and remaining for each worker and period. The first version targets Windows and Linux. Installations share the same records.

## Workers, groups, and periods

- Add workers individually, by pasting spreadsheet rows, or by importing a spreadsheet file. Sort and filter the worker list by group. A worker can belong to several groups.
- Create named vacation entitlement periods such as `25/26` and `26/27`. These labels identify the allowance a vacation is charged against. A vacation record needs a worker, its dates, and its charged period. Suggest the period from the vacation dates and let the secretary override it.
- Set a maximum number of vacation days for individual workers and for groups. A personal limit takes precedence when set. Otherwise, enforce every configured limit on the worker's groups against that worker's vacation total for the period. For example, membership in groups with limits of 24 and 30 days means the worker can use up to 24 days in that period. A personal limit of 28 days would make 28 days the applicable maximum.
- Show days used, the applicable limit, and days remaining by worker and period. Explain which rule controls when validating an entry against a limit.

## Day counting

- Let the secretary choose the vacation day-counting rule in app settings. The settings should cover calendar days, weekdays, and working days that account for holidays.
- Let the secretary mark specific dates as deductible for all workers. A marked date counts only when it falls within the worker's recorded vacation, even if the selected day-counting rule would otherwise exclude it.

## Localization

Ship English (`en`), Belarusian (`be`), and Russian (`ru`) from the first release. Keep translatable strings outside application logic and apply the selected locale to formatting such as dates and numbers. `be` is the language code for Belarusian. `BY` can be used as the region in a locale such as `be-BY`.

## GitHub CI and releases

- Develop features on `dev` and merge into `main` through a pull request. Plan GitHub Actions checks for changes on `dev` and for pull requests into `main`. Define the build and test jobs after choosing the stack.
- Publish release artifacts for Windows and Linux through GitHub Releases from `main`. Installed copies should be able to check for and apply a compatible release while preserving vacation records.
- Give the release workflow an optional `major.minor` input. With no input, increment the patch of the latest published version. With a newer major or minor selection, release the selected `major.minor` at patch `0`.

| Latest version | `major.minor` input | Next version |
| --- | --- | --- |
| `1.4.7` | Blank | `1.4.8` |
| `1.4.7` | `1.5` | `1.5.0` |
| `1.4.7` | `2.0` | `2.0.0` |

Decide the initial version, invalid-input handling, artifact formats, and update installation behavior before implementing the release workflow.

## Open decisions

- How to host and access shared records, and how simultaneous edits and offline use should work.
- Spreadsheet file formats, import fields, and how to handle possible duplicate workers.
- How to set period boundaries, suggest a period when vacation spans a boundary, and whether one vacation can draw from multiple periods.
- Default day-counting rule and holiday calendar source.
- What happens when no limit is configured or when an entry exceeds the limit. Decide how allowance changes affect historical periods.
- Application stack, packaging, and update installation details for Windows and Linux.

## Implementation sequence

1. Settle the allowance, period, and day-count rules. Choose the shared storage architecture and desktop stack.
2. Build the localized worker and group workflow, including bulk entry.
3. Add periods, vacation records, and allowance calculations. Cover personal precedence and overlapping group limits in tests.
4. Add GitHub CI, Windows and Linux packaging, release versioning, and in-app updates. Verify updates preserve existing records.
