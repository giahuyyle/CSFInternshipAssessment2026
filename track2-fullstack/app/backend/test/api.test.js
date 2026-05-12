const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmtracker-test-'));
process.env.FARMTRACKER_DB_PATH = path.join(tempDir, 'farmtracker.db');

const app = require('../server');
const { db } = require('../db');

let server;
let baseUrl;

before(async () => {
  seedTestData();
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seedTestData() {
  db.exec('DELETE FROM health_events; DELETE FROM animals; DELETE FROM paddocks;');

  const northId = db.prepare(
    'INSERT INTO paddocks (name, capacity, animal_count) VALUES (?, ?, 0)'
  ).run('North Paddock', 50).lastInsertRowid;

  const southId = db.prepare(
    'INSERT INTO paddocks (name, capacity, animal_count) VALUES (?, ?, 0)'
  ).run('South Paddock', 30).lastInsertRowid;

  const insertAnimal = db.prepare(
    'INSERT INTO animals (name, tag_number, breed, date_of_birth, paddock_id) VALUES (?, ?, ?, ?, ?)'
  );

  const bellaId = insertAnimal.run('Bella', 'TAG-001', 'Merino', '2021-03-14', northId).lastInsertRowid;
  insertAnimal.run('Daisy', 'TAG-002', 'Dorper', '2020-07-22', southId);
  insertAnimal.run('Molly', 'TAG-003', 'Merino', '2022-01-05', northId);

  db.prepare('UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?').run(northId);
  db.prepare('UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?').run(southId);
  db.prepare('UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?').run(northId);

  db.prepare(
    'INSERT INTO health_events (animal_id, event_type, notes, date, vet_name) VALUES (?, ?, ?, ?, ?)'
  ).run(bellaId, 'vaccination', 'Routine vaccination', '2024-01-15', 'Dr. Walsh');
}

async function get(path) {
  const res = await fetch(baseUrl + path);
  return { status: res.status, body: await res.json() };
}

async function post(path, body) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function put(path, body) {
  const res = await fetch(baseUrl + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// Verifies the paddocks collection endpoint returns a usable list response.
test('GET /api/paddocks returns an array', async () => {
  const { status, body } = await get('/paddocks');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
});

// Validation test: paddock capacity must be a positive integer.
test('POST /api/paddocks rejects invalid capacity', async () => {
  const negative = await post('/paddocks', {
    name: 'Invalid Negative Capacity',
    capacity: -1,
  });
  const nonNumeric = await post('/paddocks', {
    name: 'Invalid Text Capacity',
    capacity: 'many',
  });

  assert.equal(negative.status, 422);
  assert.equal(nonNumeric.status, 422);
});

// Verifies the animals list includes the latest health event field expected by the frontend.
test('GET /api/animals returns animals with latest_health_event field', async () => {
  const { status, body } = await get('/animals?page=0&limit=5');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length > 0);
  assert.ok('latest_health_event' in body[0]);
});

// Regression test: page numbers must be converted into SQL offsets.
test('GET /api/animals uses page and limit for pagination offset', async () => {
  const { body: firstPage } = await get('/animals?page=0&limit=2');
  const { status, body: secondPage } = await get('/animals?page=1&limit=2');
  const firstPageIds = firstPage.map(animal => animal.id);
  const secondPageIds = secondPage.map(animal => animal.id);

  assert.equal(status, 200);
  assert.equal(firstPage.length, 2);
  assert.equal(secondPage.length, 1);
  assert.ok(secondPageIds.every(id => !firstPageIds.includes(id)));
});

// Verifies fetching an existing animal by ID returns that exact animal.
test('GET /api/animals/:id returns a single animal', async () => {
  const { body: animals } = await get('/animals?page=0&limit=1');
  const id = animals[0].id;
  const { status, body } = await get(`/animals/${id}`);
  assert.equal(status, 200);
  assert.equal(body.id, id);
});

// Verifies missing animals return a clear not-found response.
test('GET /api/animals/:id returns 404 for unknown id', async () => {
  const { status } = await get('/animals/999999');
  assert.equal(status, 404);
});

// Verifies health events can be created for an existing animal.
test('POST /api/animals/:id/health-events creates an event', async () => {
  const { body: animals } = await get('/animals?page=0&limit=1');
  const id = animals[0].id;
  const { status, body } = await post(`/animals/${id}/health-events`, {
    event_type: 'checkup',
    date: '2025-01-10',
    vet_name: 'Dr. Test',
  });
  assert.equal(status, 201);
  assert.equal(body.event_type, 'checkup');
  assert.equal(body.animal_id, id);
});

// Regression test: failed animal creation must not leave paddock counts inflated.
test('POST /api/animals does not change paddock count when insert fails', async () => {
  const { body: paddocksBefore } = await get('/paddocks');
  const northBefore = paddocksBefore.find(paddock => paddock.name === 'North Paddock');

  const { status } = await post('/animals', {
    name: 'Duplicate Bella',
    tag_number: 'TAG-001',
    breed: 'Merino',
    date_of_birth: '2024-01-01',
    paddock_id: northBefore.id,
  });

  const { body: paddocksAfter } = await get('/paddocks');
  const northAfter = paddocksAfter.find(paddock => paddock.id === northBefore.id);

  assert.equal(status, 409);
  assert.equal(northAfter.animal_count, northBefore.animal_count);
});

// Validation test: animal creation must reject missing paddock IDs before writing.
test('POST /api/animals rejects unknown paddock_id', async () => {
  const { status } = await post('/animals', {
    name: 'No Paddock',
    tag_number: 'TAG-NO-PADDOCK',
    paddock_id: 999999,
  });

  const { body: animals } = await get('/animals?page=0&limit=50');

  assert.equal(status, 404);
  assert.equal(animals.some(animal => animal.tag_number === 'TAG-NO-PADDOCK'), false);
});

// Validation test: animal reassignment must reject missing paddock IDs before changing counts.
test('PUT /api/animals/:id rejects unknown paddock_id', async () => {
  const { body: animals } = await get('/animals?page=0&limit=50');
  const daisy = animals.find(animal => animal.tag_number === 'TAG-002');
  const { body: paddocksBefore } = await get('/paddocks');

  const { status } = await put(`/animals/${daisy.id}`, {
    paddock_id: 999999,
  });

  const { body: updatedDaisy } = await get(`/animals/${daisy.id}`);
  const { body: paddocksAfter } = await get('/paddocks');

  assert.equal(status, 404);
  assert.equal(updatedDaisy.paddock_id, daisy.paddock_id);
  assert.deepEqual(
    paddocksAfter.map(paddock => [paddock.id, paddock.animal_count]),
    paddocksBefore.map(paddock => [paddock.id, paddock.animal_count])
  );
});

// Validation test: animal creation must not overfill a paddock.
test('POST /api/animals rejects paddocks at capacity', async () => {
  const { body: paddock } = await post('/paddocks', {
    name: 'One Animal Pen',
    capacity: 1,
  });
  await post('/animals', {
    name: 'First Capacity Animal',
    tag_number: 'TAG-CAP-001',
    paddock_id: paddock.id,
  });

  const { status } = await post('/animals', {
    name: 'Second Capacity Animal',
    tag_number: 'TAG-CAP-002',
    paddock_id: paddock.id,
  });
  const { body: paddockAfter } = await get(`/paddocks/${paddock.id}`);

  assert.equal(status, 422);
  assert.equal(paddockAfter.animal_count, 1);
});

// Regression test: moving an animal must decrement the old paddock and increment the new one.
test('PUT /api/animals/:id updates old and new paddock counts when reassigned', async () => {
  const { body: animals } = await get('/animals?page=0&limit=5');
  const bella = animals.find(animal => animal.tag_number === 'TAG-001');
  const { body: paddocksBefore } = await get('/paddocks');
  const northBefore = paddocksBefore.find(paddock => paddock.name === 'North Paddock');
  const southBefore = paddocksBefore.find(paddock => paddock.name === 'South Paddock');

  const { status, body } = await put(`/animals/${bella.id}`, {
    paddock_id: southBefore.id,
  });

  const { body: paddocksAfter } = await get('/paddocks');
  const northAfter = paddocksAfter.find(paddock => paddock.id === northBefore.id);
  const southAfter = paddocksAfter.find(paddock => paddock.id === southBefore.id);

  assert.equal(status, 200);
  assert.equal(body.paddock_id, southBefore.id);
  assert.equal(northAfter.animal_count, northBefore.animal_count - 1);
  assert.equal(southAfter.animal_count, southBefore.animal_count + 1);
});

// Validation test: animal reassignment must not overfill a paddock.
test('PUT /api/animals/:id rejects paddocks at capacity', async () => {
  const { body: fullPaddock } = await post('/paddocks', {
    name: 'Full Reassignment Pen',
    capacity: 1,
  });
  await post('/animals', {
    name: 'Occupying Animal',
    tag_number: 'TAG-FULL-001',
    paddock_id: fullPaddock.id,
  });
  const { body: mover } = await post('/animals', {
    name: 'Mover Animal',
    tag_number: 'TAG-MOVER-001',
  });

  const { status } = await put(`/animals/${mover.id}`, {
    paddock_id: fullPaddock.id,
  });
  const { body: updatedMover } = await get(`/animals/${mover.id}`);
  const { body: paddockAfter } = await get(`/paddocks/${fullPaddock.id}`);

  assert.equal(status, 422);
  assert.equal(updatedMover.paddock_id, null);
  assert.equal(paddockAfter.animal_count, 1);
});
