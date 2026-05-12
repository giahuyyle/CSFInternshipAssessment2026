# Agents Guide

## Project

FarmTracker is a CSF internship assessment app for livestock records. It uses a
Node.js/Express backend, SQLite via `node:sqlite`, and a static HTML/CSS/JS frontend.

Read before changing code:
- `BRIEF.md` for assessment requirements
- `AUDIT.md` for prioritized findings
- `TODO.md` for the weight tracking feature brief
- `app/README.md` for setup, commands, and API reference

Important assessment rule: `AUDIT.md` must exist before application code changes.

## Commands

Run from `app/backend` unless noted otherwise:

```bash
npm install
node seed.js
npm start
```

To run tests:
```bash
npm test
```

The app serves the frontend at `http://localhost:3000`.

## Key Files

- Backend entrypoint: `app/backend/server.js`
- Schema and connection: `app/backend/db.js`
- Animal routes: `app/backend/routes/animals.js`
- Paddock routes: `app/backend/routes/paddocks.js`
- Integration tests: `app/backend/test/`
- Frontend files: `app/frontend/`

API routes are mounted under `/api`.

## Workflow Rules

- Plan non-trivial work before implementation, especially schema changes, API changes,
  frontend/backend coordination, or anything with three or more steps.
- Keep commits focused by concern: audit, bug fix, feature, architecture docs,
  retrospective, and README updates should not be mixed without reason.
- Keep changes small and scoped. Do not rewrite unrelated frontend or backend code.
- Prefer integration tests that exercise the Express API with a temporary SQLite database.
- Regression tests should use inputs that would fail against the old bug.
- Think through edge cases independently; commit only tests that protect important behavior.
- Verify after meaningful changes with `npm test` or another relevant check.
- Update `app/README.md` when setup, commands, seeded data, or API behavior changes.
- Do not commit generated runtime files such as `node_modules`, local SQLite databases,
  WAL files, logs, or env files.
- After making changes, confirm the relevant deliverables are still accurate:
  `AUDIT.md`, `ARCH_PROPOSAL.md`, `RETRO.md`, and `app/README.md`.
- Before calling the work complete, run `npm test` from `app/backend` and inspect the
  changed behavior directly when practical.
