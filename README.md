# rVacation

rVacation is a Windows and Linux desktop app for tracking worker vacations and balances. The app ships in English, Belarusian, and Russian. Each OS user account has its own local SQLite database. Recording and viewing vacations works offline.

## Install and start

1. Download the Windows x64 installer or Linux x86-64 AppImage from [GitHub Releases](https://github.com/Severnbli/rVacation/releases/latest).
2. Run the Windows installer. On Linux, make the AppImage executable before opening it. If your distribution lacks FUSE support, use the AppImage's `--appimage-extract-and-run` option to launch it.
3. Add workers from Overview and set the start date of each worker’s first working year. The Periods page shows recurring years, balance adjustments, templates, and date change history. Groups and day-counting settings can be configured as needed. If you have records in the old shared service, import them before saving anything locally.

The Windows installer is unsigned. Windows may ask you to confirm that you trust the download. The app checks GitHub for updates at every launch. When an update is ready, choose **Restart and install** in the popup or select **Later** to keep working and install it from Settings.

## Back up or move local records

Choose **Settings → Local records → Open data folder**, then quit rVacation and copy `rvacation.sqlite` to a backup location. To restore or move your records, open the destination's data folder the same way, quit the app, and place the backup there as `rvacation.sqlite`. Save a copy of the destination database first if it already contains records.

The database lives outside the installation directory. When an update changes the schema, rVacation migrates the existing file in a transaction the next time it opens.

## Develop and release

Run `npm ci` from the repository root with Node.js 24, then run `npm start` to open the app. Run `npm test` for the domain, local storage, and release versioning checks. Run `npm run build -- --x64` on each target operating system to create its installer under `dist/`.

CI checks `dev` and pull requests into `main` on both platforms. After merging to `main`, run the **Release** workflow. Leave the series field blank for a patch release or enter a newer `major.minor` to start at patch zero. The first blank run publishes `0.1.0`.

- [Project plan](docs/project-plan.md) describes vacation rules and remaining decisions.
- [Repository guidance](AGENTS.md) describes the development workflow.
