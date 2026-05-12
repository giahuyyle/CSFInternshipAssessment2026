const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmtracker-weights-test-'));
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
  db.exec('DELETE FROM weights; DELETE FROM health_events; DELETE FROM animals; DELETE FROM paddocks;');

  const paddockId = db.prepare(
    'INSERT INTO paddocks (name, capacity, animal_count) VALUES (?, ?, 0)'
  ).run('Weight Test Paddock', 10).lastInsertRowid;

  const animalId = db.prepare(
    'INSERT INTO animals (name, tag_number, breed, date_of_birth, paddock_id) VALUES (?, ?, ?, ?, ?)'
  ).run('Bella', 'TAG-WEIGHT-SEED', 'Merino', '2021-03-14', paddockId).lastInsertRowid;

  db.prepare('UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?').run(paddockId);

  db.prepare(
    'INSERT INTO weights (animal_id, weight_kg, date, notes) VALUES (?, ?, ?, ?)'
  ).run(animalId, 42.1, '2024-09-01', 'Baseline test weight');
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

async function createAnimal(tagNumber) {
  const { body } = await post('/animals', {
    name: 'Weight Test Animal',
    tag_number: tagNumber,
  });
  return body;
}

// Verifies weight measurements can be logged for an existing animal.
test('POST /api/animals/:id/weights creates a weight record', async () => {
  const animal = await createAnimal('TAG-WEIGHT-001');

  const { status, body } = await post(`/animals/${animal.id}/weights`, {
    weight_kg: 45.2,
    date: '2024-11-15',
    notes: 'Post-shearing weigh-in',
  });

  assert.equal(status, 201);
  assert.equal(body.animal_id, animal.id);
  assert.equal(body.weight_kg, 45.2);
  assert.equal(body.date, '2024-11-15');
  assert.equal(body.notes, 'Post-shearing weigh-in');
});

// Validation test: weight measurements must include a positive weight.
test('POST /api/animals/:id/weights rejects missing or non-positive weight_kg', async () => {
  const animal = await createAnimal('TAG-WEIGHT-VALIDATION-001');

  const missing = await post(`/animals/${animal.id}/weights`, {
    date: '2024-11-15',
  });
  const zero = await post(`/animals/${animal.id}/weights`, {
    weight_kg: 0,
    date: '2024-11-15',
  });
  const negative = await post(`/animals/${animal.id}/weights`, {
    weight_kg: -1,
    date: '2024-11-15',
  });

  assert.equal(missing.status, 422);
  assert.equal(zero.status, 422);
  assert.equal(negative.status, 422);
});

// Validation test: weight measurements cannot be logged against missing animals.
test('POST /api/animals/:id/weights returns 404 for unknown animal', async () => {
  const { status } = await post('/animals/999999/weights', {
    weight_kg: 45.2,
    date: '2024-11-15',
  });

  assert.equal(status, 404);
});

// Verifies weight history is returned newest first.
test('GET /api/animals/:id/weights returns weights ordered by date descending', async () => {
  const animal = await createAnimal('TAG-WEIGHT-HISTORY-001');
  await post(`/animals/${animal.id}/weights`, {
    weight_kg: 38.4,
    date: '2024-08-01',
  });
  await post(`/animals/${animal.id}/weights`, {
    weight_kg: 41.9,
    date: '2024-10-01',
  });

  const { status, body } = await get(`/animals/${animal.id}/weights`);

  assert.equal(status, 200);
  assert.deepEqual(body.map(weight => weight.date), ['2024-10-01', '2024-08-01']);
});

// Verifies missing animals return a clear not-found response for weight history.
test('GET /api/animals/:id/weights returns 404 for unknown animal', async () => {
  const { status } = await get('/animals/999999/weights');
  assert.equal(status, 404);
});
