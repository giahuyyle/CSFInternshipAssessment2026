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

  db.prepare('UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?').run(northId);
  db.prepare('UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?').run(southId);

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

// Verifies the animals list includes the latest health event field expected by the frontend.
test('GET /api/animals returns animals with latest_health_event field', async () => {
  const { status, body } = await get('/animals?page=0&limit=5');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length > 0);
  assert.ok('latest_health_event' in body[0]);
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
