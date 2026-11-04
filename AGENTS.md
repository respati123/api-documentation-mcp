# Repository Guidelines (mcp)

The `api-documentation-mcp` package: command-line and MCP access to the API Documentation desktop app. It reads and writes the same local workspace database the app uses. See `README.md` for what each command does.

## Layout

```
src/
├── index.ts          entry: no arguments or "mcp" starts the MCP server, anything else is a CLI subcommand
├── cli.ts            the CLI
├── mcp.ts            the MCP server, including older tool names kept for existing clients
├── mcp-surface.ts    which commands an MCP client gets
├── registry.ts       the one list of commands, read by the CLI, the MCP server, and the docs
├── commands/         commands, one file per group
├── operations.ts     collection edits, shared by direct commands and previewed batches
├── store.ts          the app's database
├── redact.ts         hides secret values in anything returned
├── send.ts           request.send
└── test/             tests
```

## Commands

Install with `npm ci`. Node.js 22 or newer.

- `npm run typecheck`
- `npm test`
- `npm run build`: bundles to `dist/index.js`

## Rules that keep user data safe

- Secret values are never returned. Anything that returns request or variable data goes through `redact.ts`.
- MCP clients change collections only through `changes.preview` and `changes.apply`, so the user sees the diff first. Do not expose a direct collection write through `mcp-surface.ts`.
- Commands that delete require `"confirm": true`.
- Older tool names keep working. Removing one breaks clients configured earlier.
- Tests set `API_DOCS_USER_DATA_DIR` to a temporary folder. A test never touches the real app data.

## Git

- Start every change from an up-to-date `main`, on a branch: `feat/<scope>-<desc>`, `fix/...`, `test/...`, `refactor/...`, `chore/...`.
- Never commit directly to `main`. Never force-push `main`, and never move or delete a pushed tag.
- Conventional Commits. One logical change per commit, with its tests.
- Stage explicit paths, then read `git diff --cached --name-status` before committing. A file staged earlier goes into the next commit.
- Read `git log` before any `git reset`. Rewrite only your own unpushed commits.
- Never drop a stash you did not create.
- Never commit secrets, `.env`, or build output.

## Pull requests

- Base is `main`. One topic per pull request.
- The description says what changed, why, how it was checked, and what the reviewer should know. List only checks that actually ran.
- Before pushing, run the commands above. Merge only when CI is green, using a merge commit (`gh pr merge --merge`).

## Changes across repos

This package reads the desktop app's database. A change to that format goes in the desktop app first, with the old format still readable. Say the order in both pull request descriptions.

## Release

A merge to `main` publishes nothing. `package.json` holds the version. Pushing a tag `vX.Y.Z` that matches it runs `publish.yml`, which checks and publishes to npm. The workflow can also be run by hand.

Publishing currently fails with `EOTP`, because the `NPM_TOKEN` secret cannot skip 2FA. Version 0.2.0 is on `main` and is not on npm.

## Actions that need an explicit request

An agent does these only when asked for that action, in that conversation:

- push, open a pull request, merge
- create or push a tag
- publish to npm
- change repo settings, secrets, or variables

A request for one does not cover the next. If a permission check refuses an action, stop and report it. Do not reach the same result another way.

## When something fails

- CI red: fix the cause. Do not skip the check.
- GitHub `5xx` during a workflow: read what already happened, then re-run the failed job once. A partly finished run may have already changed something.
