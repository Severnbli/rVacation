# rVacation project guidance

- At the start of every task, review the affected UI and UX. Identify the user flow, entry point, and states before making changes. For UI changes, exercise the flow in the running app with attention to keyboard navigation, narrow windows, and localization.
- Read [the project plan](docs/project-plan.md) before changing product behavior, architecture, localization, CI, or releases. Read the [README](README.md) for setup and verification commands.
- Develop on `dev` and integrate through pull requests into `main`. Run relevant checks and make one focused local commit per completed task. Push only when requested.
- Preserve English, Belarusian, and Russian coverage when changing user-facing text. Enforce allowance precedence as documented in the project plan.
- Use an en dash in place of an em dash in project material.
- Run `npm test` from the repository root for application changes. Check packaging on both platforms when changing the release or desktop runtime. For guidance-only changes, run `git diff --cached --check` and verify the documentation links.
