# rVacation

rVacation is a Windows and Linux desktop app for tracking worker vacations and balances. The app ships in English, Belarusian, and Russian. Desktop clients share their records through an office-hosted service.

## Install and connect

1. Download the Windows x64 installer or Linux x86-64 AppImage from [GitHub Releases](https://github.com/Severnbli/rVacation/releases/latest).
2. Run the Windows installer. On Linux, make the AppImage executable before opening it. If your distribution lacks FUSE support, use the AppImage's `--appimage-extract-and-run` option to launch it.
3. In Settings, enter the service address and access key provided by your administrator. Once connected, create a period and add workers. Groups and day-counting settings can be configured as needed.

The Windows installer is unsigned. Windows may ask you to confirm that you trust the download. The app checks the GitHub release feed and offers **Restart and install** in Settings when an update has downloaded.

## Host the shared records service

Download and extract the service archive from the same release. Install Node.js 24 on the host. From the extracted directory, set `RVACATION_KEY` to a randomly generated shared secret of at least 24 characters, then run:

```sh
node server/index.mjs
```

The service listens at `127.0.0.1:8787` by default and stores records in `rvacation.sqlite`. Set `RVACATION_DB` to use a dedicated database path, `RVACATION_PORT` to change the port, and `RVACATION_HOST` to change the bind address.

For multiple computers, put the service behind an HTTPS reverse proxy on the office network, forwarding `/v1/records` and the Authorization header. Give authorized secretaries the HTTPS address and shared key. Clients using that key can read and edit all records. HTTPS is required for remote connections. A desktop client on the host can use `http://127.0.0.1:8787` for local evaluation. Stop the service before making a file copy of the SQLite database, or use an SQLite online backup tool.

## Develop and release

Run `npm ci` from the repository root with Node.js 24. Start the service as above and run `npm start` in another terminal. Run `npm test` for the domain, service, and versioning checks. Run `npm run build -- --x64` on each target operating system to create its installer under `dist/`.

CI checks `dev` and pull requests into `main` on both platforms. After merging to `main`, run the **Release** workflow. Leave the series field blank for a patch release or enter a newer `major.minor` to start at patch zero. The first blank run publishes `0.1.0`.

- [Project plan](docs/project-plan.md) describes vacation rules and remaining decisions.
- [Repository guidance](AGENTS.md) describes the development workflow.
