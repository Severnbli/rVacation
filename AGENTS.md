# rVacation project guidance

- Codex uses this file as the repository entry point. Read [the project plan](docs/project-plan.md) before changing product behavior, architecture, localization, CI, or releases.
- The repository is in the planning stage. Start implementation only when requested. Treat open decisions in the plan as unresolved requirements.
- Use `dev` for development and pull requests from `dev` into `main` for integration. Run relevant checks and make one focused local commit per completed task. Push only when requested.
- Preserve English, Belarusian, and Russian coverage when changing user-facing text. All applicable allowance rules must be enforced according to the precedence in the project plan.
- Use an en dash in place of an em dash in project material.
- For guidance-only changes, run `git diff --cached --check` from the repository root after staging and verify the documentation links. Build and test commands will be documented once those entry points exist.
