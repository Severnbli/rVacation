# rVacation project plan

## Product scope

rVacation is a desktop app for secretaries to maintain worker records, record vacations, and see the allowance used and remaining for each worker and period. It targets Windows and Linux. The desktop app opens a SQLite database in its per-user data folder and handles records locally.

## Local storage and updates

- Store `rvacation.sqlite` outside the installation directory. The Electron main process owns the database and applies the same vacation rules for every change.
- Use SQLite's `user_version` to track schema migrations. Run pending migrations in a transaction and advance the schema version only when the migration succeeds. Keep the database intact if opened by a version of the app that cannot read it.
- Offer import from a backup of the former service before the first local save. Preserve record links, recorded day counts, and day-counting settings. Local records are independent on each installation.

## Workers, groups, and periods

- Add workers individually, by pasting spreadsheet rows, or by importing a spreadsheet file. Import uses the first column of CSV, TSV, and XLSX sheets. Workers can share a name. Sort and filter the worker list by group. A worker can belong to several groups.
- Create named vacation entitlement periods such as `25/26` and `26/27`. These labels identify the allowance a vacation is charged against. A vacation record needs a worker, its dates, and its charged period. Suggest the period containing the vacation start date and let the secretary override it. Periods cannot overlap. Each vacation is charged to one period.
- Set a maximum number of vacation days for individual workers and for groups. A personal limit takes precedence when set. Otherwise, enforce every configured limit on the worker's groups against that worker's vacation total for the period. For example, membership in groups with limits of 24 and 30 days means the worker can use up to 24 days in that period. A personal limit of 28 days would make 28 days the applicable maximum.
- Show days used, the applicable limit, and days remaining by worker and period. Show whether a personal or group rule controls each balance. No configured limit means unlimited. Block new entries that would exceed a limit. Changes to a worker or group limit can surface an overage on an existing balance.

## Day counting

- Let the secretary choose the vacation day-counting rule in app settings. Use calendar days by default. Settings also support weekdays and weekdays excluding holiday dates entered by the secretary. Recorded day counts stay fixed unless the vacation dates change.
- Let the secretary mark specific dates as deductible for all workers. A marked date counts only when it falls within the worker's recorded vacation, even if the selected day-counting rule would otherwise exclude it.

## Localization

Ship English (`en`), Belarusian (`be`), and Russian (`ru`) from the first release. Keep translatable strings outside application logic and apply the selected locale to formatting such as dates and numbers. `be` is the language code for Belarusian. `BY` can be used as the region in a locale such as `be-BY`.

## GitHub CI and releases

- Develop features on `dev` and merge into `main` through a pull request. GitHub Actions tests and packages both platforms on changes to `dev` and on pull requests into `main`.
- The manual Release workflow publishes the Windows NSIS installer, Linux AppImage, and updater metadata through GitHub Releases from `main`. The desktop app checks for updates at launch and offers to restart once the update has downloaded. Desktop updates retain the local database.
- Give the release workflow an optional `major.minor` input. With no input, increment the patch of the latest published version. With a newer major or minor selection, release the selected `major.minor` at patch `0`.

| Latest version | `major.minor` input | Next version |
| --- | --- | --- |
| `1.4.7` | Blank | `1.4.8` |
| `1.4.7` | `1.5` | `1.5.0` |
| `1.4.7` | `2.0` | `2.0.0` |

The first release defaults to `0.1.0`. An explicit series must be higher than the latest stable release. Invalid or older inputs fail before packaging.

## UI and UX

Start each task by reviewing how it affects the secretary's workflow, including the first-use experience, feedback when records cannot be saved, and recovery when the local database cannot be opened. Check affected screens with a keyboard and review the layout in all three shipping languages.

## Open decisions

- Whether to split one vacation between multiple periods.
- Whether to provide built-in holiday calendars or keep office-managed dates.
- Signing and packaging for additional operating system architectures.
