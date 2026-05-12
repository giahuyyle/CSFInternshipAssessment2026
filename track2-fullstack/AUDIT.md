# Audit

## Findings

1. **Paddock occupancy can desync.**
   - `POST /api/animals` increments `paddocks.animal_count` before the animal insert succeeds, so failures such as duplicate tag numbers can inflate counts.
   - `PUT /api/animals/:id` increments the new paddock when moving an animal but never decrements the old one.
   - These related writes are not transactional.

2. **Animal pagination is wrong.**
   - `GET /api/animals` passes `page` directly as SQL `OFFSET`.
   - With `limit=5`, page 1 should skip 5 rows but currently skips 1.

3. **Write validation is incomplete.**
   - `POST /api/animals` and `PUT /api/animals/:id` do not enforce paddock capacity or validate paddock IDs before changing counts.
   - `POST /api/paddocks` accepts invalid capacities such as negative numbers or non-numeric strings.

4. **`animal_count` is duplicated state.**
   - It is derived from `animals.paddock_id` but stored separately.
   - Every create, update, delete, seed, and future feature path must keep both tables synchronized, which is fragile.

5. **API and frontend behavior is inconsistent.**
   - `POST /api/animals` returns `200` instead of `201 Created`.
   - The frontend renders API-controlled values with `innerHTML`, creating an XSS risk for fields like names, breed, vet name, and notes.
   - The animal list and detail pages show raw `paddock_id` values instead of paddock names.

6. **`GET /api/animals` has an N+1 query pattern.**
   - It fetches animals, then queries the latest health event once per animal.
   - This is acceptable for seed data but will slow down as records grow.

## Fix First

1. **Paddock integrity.** Fix reassignment counts, validate target paddocks/capacity, and wrap related writes in transactions.
2. **Pagination.** Use `page * limit` as the SQL offset.
3. **API consistency.** Return `201 Created` from animal creation.
4. **Frontend safety.** Avoid unsafe `innerHTML`, add visible API error states, and display paddock names.
5. **Weight tracking.** Add the required feature after the baseline correctness issues are covered.

## Leave For Later

I would defer a frontend framework rewrite, styling polish, and broad end-to-end test coverage. The N+1 latest-health-event query is real architectural debt, but I would leave it for a later refactor with a joined query that preserves the existing `latest_health_event` response shape. The duplicated `animal_count` state is the architectural issue I would address first because it affects correctness as well as design.
