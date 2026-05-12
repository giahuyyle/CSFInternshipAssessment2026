# Architecture Proposal: Derive Paddock Occupancy

## Problem

`paddocks.animal_count` duplicates information already stored in `animals.paddock_id`.
That makes every animal create, update, delete, seed, and future import path responsible
for keeping two tables synchronized. The current bug-fix pass added transactions and
validation around those writes, but the design still has unnecessary drift risk: any
new code path that changes `animals.paddock_id` must also remember to update
`paddocks.animal_count`, and any missed update or partially failed write leaves the API
reporting the wrong occupancy and enforcing capacity from stale data.

## Goal

Make paddock occupancy derived from the `animals` table while preserving the existing
API response shape:

```json
{
  "id": 1,
  "name": "North Paddock",
  "capacity": 50,
  "animal_count": 12
}
```

The frontend should continue to read `animal_count`; the backend should stop storing it.

## Why This Issue First

This is a bigger risk than the N+1 latest-health-event query because it affects
correctness, not just performance. A slow animal list can be optimized later without
changing user-visible behavior. A stale paddock count can show wrong occupancy, reject a
valid assignment, or allow an over-capacity assignment. It also touches more write paths,
so every future animal import, reassignment, or delete feature has to preserve the same
counter invariant.

## Proposed Change

1. Remove `animal_count` from the `paddocks` schema.
2. Return paddock counts with a derived aggregate query:

```sql
SELECT
  p.id,
  p.name,
  p.capacity,
  COUNT(a.id) AS animal_count
FROM paddocks p
LEFT JOIN animals a ON a.paddock_id = p.id
GROUP BY p.id
ORDER BY p.id;
```

3. Use the same derived count when fetching a single paddock:

```sql
SELECT
  p.id,
  p.name,
  p.capacity,
  COUNT(a.id) AS animal_count
FROM paddocks p
LEFT JOIN animals a ON a.paddock_id = p.id
WHERE p.id = ?
GROUP BY p.id;
```

4. Replace capacity validation in `routes/animals.js` with a derived count lookup:

```sql
SELECT
  p.*,
  COUNT(a.id) AS animal_count
FROM paddocks p
LEFT JOIN animals a ON a.paddock_id = p.id
WHERE p.id = ?
GROUP BY p.id;
```

5. Delete all manual `UPDATE paddocks SET animal_count = ...` statements from animal
create, reassignment, delete, tests, and seed data.

## Implementation Plan

1. Add a helper in `routes/paddocks.js`, or a small shared query module, for selecting
   paddocks with derived `animal_count`.
2. Update `GET /api/paddocks` and `GET /api/paddocks/:id` to use the aggregate query.
3. Update `validatePaddockAssignment` in `routes/animals.js` to read the derived count.
4. Remove paddock count updates from:
   - `POST /api/animals`
   - `PUT /api/animals/:id`
   - `DELETE /api/animals/:id`
5. Simplify transactions in animal routes. Keep a transaction for reassignment only if
   later behavior needs multiple writes; after this change, animal create/update/delete
   can each be a single animal-table write.
6. Change the schema in `db.js` so new databases create `paddocks` without
   `animal_count`.
7. Update `seed.js` and tests to stop inserting or asserting stored count mutations.
8. Keep the API contract unchanged so the frontend does not need a behavior change.

## Migration Notes

This assessment app does not currently have a migration system. For this codebase, the
smallest safe path is:

1. Change `CREATE TABLE paddocks` for new databases.
2. For existing local SQLite files, document that developers should rerun `node seed.js`
   after deleting the old local `farmtracker.db`.

If production-style migrations were required, add a one-time migration:

```sql
CREATE TABLE paddocks_new (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT    NOT NULL UNIQUE,
  capacity INTEGER NOT NULL
);

INSERT INTO paddocks_new (id, name, capacity)
SELECT id, name, capacity FROM paddocks;

DROP TABLE paddocks;
ALTER TABLE paddocks_new RENAME TO paddocks;
```

That migration must run with foreign keys temporarily disabled or inside a migration
sequence that recreates dependent references safely.

## Tests To Add Or Update

- `GET /api/paddocks` returns accurate derived counts after animal creation.
- `GET /api/paddocks/:id` returns accurate derived counts after reassignment.
- Deleting an animal reduces the derived count without any paddock update statement.
- Failed duplicate animal creation does not affect derived counts.
- Capacity validation still rejects creating or moving an animal into a full paddock.

Existing frontend behavior should continue to pass because `animal_count` remains in the
JSON response.

## Trade-offs

Derived counts add a small aggregate query cost, but paddock lists are small in this app
and the correctness benefit is larger. If the dataset grew substantially, an index on
`animals(paddock_id)` would keep these count queries cheap.

I would implement this after the required weight tracking feature because it changes a
shared API implementation path and touches many existing tests. The proposal keeps the
external contract stable while removing the highest-risk duplicated state.
