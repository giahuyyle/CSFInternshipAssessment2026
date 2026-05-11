# Agents Guide

## Project Context

FarmTracker is a small livestock record management app for the CSF internship assessment. It has a Node.js/Express backend using SQLite via `node:sqlite`, plus a simple static HTML/CSS/JS frontend.

Read these files before making changes:
- `BRIEF.md` for assessment deliverables
- `TODO.md` for the required weight tracking feature
- `app/README.md` for setup, test commands, and API reference

Important assessment rule: write `AUDIT.md` before touching application code.

## Commands

Run commands from `app/backend` unless noted otherwise.

```bash
npm install
node seed.js
npm start
npm test
```

The app serves the frontend at `http://localhost:3000`.

## Architecture Notes

- Backend entrypoint: `app/backend/server.js`
- Database schema and connection: `app/backend/db.js`
- Animal routes: `app/backend/routes/animals.js`
- Paddock routes: `app/backend/routes/paddocks.js`
- Integration tests: `app/backend/test/api.test.js`
- Frontend files: `app/frontend/`

API routes are mounted under `/api`, so animal weight endpoints should follow the existing pattern:
- `POST /api/animals/:id/weights`
- `GET /api/animals/:id/weights`

## Working Rules

- Keep changes small and focused.
- Do not mix audit writing, bug fixes, feature work, and retrospective updates in one undifferentiated change.
- Preserve the simple stack unless there is a strong reason to change it.
- Prefer integration tests that exercise the Express API and temporary SQLite database.
- Update `app/README.md` if setup, commands, or API behavior changes.
- Avoid rewriting unrelated frontend or backend code while implementing the required feature.

## Workflow

- Plan non-trivial work before implementing, especially anything with 3+ steps, schema changes, API changes, frontend/backend coordination, or architectural decisions.
- If implementation goes off track, stop and revise the plan before continuing.
- Keep plans concrete and implementation-oriented, not vague notes.
- After user corrections, record the lesson in local task notes if such a file already exists; otherwise fold the correction into the current work.
- Verify before calling work done: run tests, inspect relevant behavior, and compare expected versus actual behavior.
- For non-trivial changes, pause before finalizing and check whether there is a simpler, cleaner solution.
- Keep simple fixes simple.

## Task Management

- For multi-step work, maintain a short checklist in the conversation or a task file if one already exists.
- Mark items complete as progress is made.
- Explain high-level changes at each meaningful checkpoint.
- Capture corrections or lessons when they affect future work.
- Avoid creating extra task-management files unless the user asks for them.

## Core Principles

- Simplicity first: make the smallest change that solves the real problem.
- Root cause over temporary workaround.
- Minimal impact: touch only what is necessary.
- Verification required: do not present work as complete without evidence.
- Assessment discipline: write `AUDIT.md` before app code changes and keep deliverables separated.

## Required Deliverables

Before final submission, ensure these files exist and are accurate:
- `AUDIT.md`
- Implementation and tests for weight tracking
- Either an implemented architectural improvement or `ARCH_PROPOSAL.md`
- `RETRO.md`
- Updated `app/README.md`

## Weight Tracking Acceptance Criteria

The required feature must satisfy:
- `POST /api/animals/:id/weights` creates a weight record and returns `201`
- Missing or non-positive `weight_kg` returns `422`
- Missing animal returns `404`
- `GET /api/animals/:id/weights` returns records ordered by date descending
- Animal detail frontend displays latest weight, weight history, and a form to add a new measurement
- Tests cover happy path and validation/error cases
