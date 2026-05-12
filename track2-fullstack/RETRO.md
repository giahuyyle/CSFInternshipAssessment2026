# Retrospective

## Trade-offs

- I fixed correctness issues before adding weight tracking, even though the feature was
  the most visible deliverable. Paddock count drift, incorrect pagination, weak
  validation, and unsafe rendering could all produce incorrect API responses or
  user-visible failures.
- I favored integration tests over isolated unit tests because the main contract is the
  interaction between Express routes, SQLite constraints, and HTTP status codes.
- I kept weight tracking inside the existing Express and static frontend structure. A
  service or repository layer might help later, but it would add abstraction before this
  small app clearly needs it.

## With More Time

- I would implement the derived paddock occupancy proposal with an explicit migration
  instead of relying on reseeding local SQLite files.
- I would replace the N+1 latest-health-event lookup with a joined or window-function
  query that preserves the existing `latest_health_event` response shape.
- I would add browser-level end-to-end coverage for the animal detail workflow after the
  core API behavior is stable.

## Deliberately Left Alone

- I did not rewrite the frontend framework or restyle the app broadly because that would
  add scope without improving the core data integrity behavior under assessment.
- I wrote `ARCH_PROPOSAL.md` instead of implementing the occupancy refactor because it
  affects schema design, seed data, route logic, tests, and compatibility with existing
  local databases. It deserves its own focused change.
