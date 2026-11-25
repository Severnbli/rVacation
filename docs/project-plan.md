# rVacation project plan

## Product scope

rVacation is a desktop app for secretaries to maintain worker records, record vacations, and see the allowance used and remaining for each worker and period. It targets Windows and Linux. The desktop app opens a SQLite database in its per-user data folder and handles records locally.

## Local storage and updates

- Store `rvacation.sqlite` outside the installation directory. The Electron main process owns the database and applies the same vacation rules for every change.
- Use SQLite's `user_version` to track schema migrations. Run pending migrations in a transaction and advance the schema version only when the migration succeeds. Keep the database intact if opened by a version of the app that cannot read it.
- Offer import from a backup of the former service before the first local save. Preserve record links, historical charges, and day-counting settings. Credit configured holidays at migration when a recorded charge matches the full charge before holidays. Local records are independent on each installation.

## Workers, groups, and periods

- Add workers individually, by pasting spreadsheet rows, or by importing a spreadsheet file. Import uses the first column of CSV, TSV, and XLSX sheets. Workers can share a name. Sort and filter the worker list by group. A worker can belong to several groups.
- Mark former workers as fired from Workers. Hide them and their vacations from normal views, totals, and selectors. Recovering a worker restores their visibility with their vacation history, groups, and allowance.
- Set the start date of each worker’s first working year. Periods are inclusive and renew automatically. For example, a year starting September 1 runs through August 31. A February 29 start renews on March 1 in non-leap years.
- Save a name and date as a template. Applying a template fills the name of the first period and the start date. Both fields remain editable for that worker. The Periods page shows the worker’s history and the Overview finds the period that contains the selected date.
- Record annual vacation, social leave, and maternity leave for an active worker. Block intersections across all types. Suggest the worker’s period containing the start of an annual vacation and allow the secretary to charge another period. Each annual vacation is charged to one period.
- Count social and maternity leave in calendar days. The portion of social leave exceeding the per-period threshold and every maternity leave day extend the period. The next period starts the following day, shifting later periods by the same number of days. The default social leave threshold is 14 days and can be changed in Settings.
- For each period, allow a manual remaining vacation balance and a count of social leave already taken that has no leave record. Subtract later annual vacation from the manual balance and enforce the applicable worker or group limit. Add prior social leave to dated social leave for working-year calculations.
- Keep the original start date and the date changes caused by leave, threshold adjustments, and manual corrections in the worker’s period history. Allow an optional name for manual start-date and social leave corrections.
- Existing shared period names and start dates become templates. Workers with vacation history keep the periods they used and the periods between them. Their first recurring year starts the day after the last such period. Set the first start date for existing workers who have no vacation history.
- Set a maximum number of vacation days for individual workers and for groups. A personal limit takes precedence when set. Otherwise, enforce every configured limit on the worker's groups against that worker's vacation total for the period. For example, membership in groups with limits of 24 and 30 days means the worker can use up to 24 days in that period. A personal limit of 28 days would make 28 days the applicable maximum.
- Show days used, the applicable limit, and days remaining by worker and period. Show whether a personal or group rule controls each balance. No configured limit means unlimited. Block new entries that would exceed a limit. Changes to a worker or group limit can surface an overage on an existing balance.

## Day counting

- Count calendar days by default, with a weekdays option. Configured public holidays are free in either mode. When holiday dates change, update charges for recorded annual vacations using the weekend rule and extra chargeable dates saved with each vacation.
- Let the secretary mark specific dates as chargeable for all workers. Those dates count when they fall within a vacation and are outside the holiday list, even if the day-counting rule would exclude them.

## Localization

Ship English (`en`), Belarusian (`be`), and Russian (`ru`) from the first release. Keep translatable strings outside application logic and apply the selected locale to formatting such as dates and numbers. `be` is the language code for Belarusian. `BY` can be used as the region in a locale such as `be-BY`.

## GitHub CI and releases

- Develop features on `dev` and merge into `main` through a pull request. GitHub Actions tests and packages both platforms on changes to `dev` and on pull requests into `main`.
- The manual Release workflow publishes the Windows NSIS installer, Linux AppImage, and updater metadata through GitHub Releases from `main`. The desktop app checks for updates at every launch and shows a popup once an update has downloaded. Users can restart and install from the popup or defer installation and return to Settings later. Desktop updates retain the local database.
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
