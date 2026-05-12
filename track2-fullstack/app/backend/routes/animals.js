const express = require('express');
const router = express.Router();
const { db } = require('../db');

function withTransaction(work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function normalizePaddockId(value) {
  if (value === undefined || value === null) return { paddockId: value };

  const paddockId = Number(value);
  if (!Number.isInteger(paddockId) || paddockId <= 0) {
    return { error: { status: 422, message: 'paddock_id must be a positive integer' } };
  }

  return { paddockId };
}

function validatePaddockAssignment(value, currentPaddockId = null) {
  const normalized = normalizePaddockId(value);
  if (normalized.error) return normalized;

  const { paddockId } = normalized;
  if (paddockId === undefined || paddockId === null) return { paddockId };
  if (paddockId === currentPaddockId) return { paddockId };

  const paddock = db.prepare('SELECT * FROM paddocks WHERE id = ?').get(paddockId);
  if (!paddock) {
    return { error: { status: 404, message: 'Paddock not found' } };
  }

  if (paddock.animal_count >= paddock.capacity) {
    return { error: { status: 422, message: 'Paddock is at capacity' } };
  }

  return { paddockId };
}

router.get('/', (req, res) => {
  const page = parseInt(req.query.page) || 0;
  const limit = parseInt(req.query.limit) || 10;
  const offset = page * limit;

  const animals = db.prepare(
    'SELECT * FROM animals LIMIT ? OFFSET ?'
  ).all(limit, offset);

  const result = animals.map(animal => {
    const latestEvent = db.prepare(`
      SELECT * FROM health_events
      WHERE animal_id = ?
      ORDER BY date DESC
      LIMIT 1
    `).get(animal.id);
    return { ...animal, latest_health_event: latestEvent ?? null };
  });

  res.json(result);
});

router.post('/', (req, res) => {
  const { name, tag_number, breed, date_of_birth, paddock_id } = req.body;

  if (!name || !tag_number) {
    return res.status(400).json({ error: 'name and tag_number are required' });
  }

  const paddockValidation = validatePaddockAssignment(paddock_id);
  if (paddockValidation.error) {
    return res.status(paddockValidation.error.status).json({ error: paddockValidation.error.message });
  }

  let animal;
  try {
    animal = withTransaction(() => {
      const result = db.prepare(
        'INSERT INTO animals (name, tag_number, breed, date_of_birth, paddock_id) VALUES (?, ?, ?, ?, ?)'
      ).run(name, tag_number, breed ?? null, date_of_birth ?? null, paddockValidation.paddockId ?? null);

      if (paddockValidation.paddockId) {
        db.prepare(
          'UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?'
        ).run(paddockValidation.paddockId);
      }

      return db.prepare('SELECT * FROM animals WHERE id = ?').get(result.lastInsertRowid);
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed: animals.tag_number')) {
      return res.status(409).json({ error: 'tag_number must be unique' });
    }
    throw err;
  }

  res.status(201).json(animal);
});

router.get('/:id', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });
  res.json(animal);
});

router.put('/:id', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const requestedPaddockId = 'paddock_id' in req.body ? req.body.paddock_id : animal.paddock_id;
  const paddockValidation = validatePaddockAssignment(requestedPaddockId, animal.paddock_id);
  if (paddockValidation.error) {
    return res.status(paddockValidation.error.status).json({ error: paddockValidation.error.message });
  }

  const updates = {
    name:          req.body.name          ?? animal.name,
    tag_number:    req.body.tag_number    ?? animal.tag_number,
    breed:         req.body.breed         ?? animal.breed,
    date_of_birth: req.body.date_of_birth ?? animal.date_of_birth,
    paddock_id:    paddockValidation.paddockId,
  };

  const updated = withTransaction(() => {
    if (updates.paddock_id !== animal.paddock_id) {
      if (animal.paddock_id) {
        db.prepare(
          'UPDATE paddocks SET animal_count = animal_count - 1 WHERE id = ?'
        ).run(animal.paddock_id);
      }

      if (updates.paddock_id) {
        db.prepare(
          'UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?'
        ).run(updates.paddock_id);
      }
    }

    db.prepare(`
      UPDATE animals
      SET name = ?, tag_number = ?, breed = ?, date_of_birth = ?, paddock_id = ?
      WHERE id = ?
    `).run(updates.name, updates.tag_number, updates.breed, updates.date_of_birth, updates.paddock_id, req.params.id);

    return db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  if (animal.paddock_id) {
    db.prepare(
      'UPDATE paddocks SET animal_count = animal_count - 1 WHERE id = ?'
    ).run(animal.paddock_id);
  }

  db.prepare('DELETE FROM animals WHERE id = ?').run(req.params.id);
  res.json({ message: 'deleted' });
});

router.get('/:id/health-events', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const events = db.prepare(
    'SELECT * FROM health_events WHERE animal_id = ? ORDER BY date DESC'
  ).all(req.params.id);
  res.json(events);
});

router.post('/:id/health-events', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const { event_type, notes, date, vet_name } = req.body;
  if (!event_type || !date) {
    return res.status(400).json({ error: 'event_type and date are required' });
  }

  const result = db.prepare(
    'INSERT INTO health_events (animal_id, event_type, notes, date, vet_name) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, event_type, notes ?? null, date, vet_name ?? null);

  const event = db.prepare('SELECT * FROM health_events WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(event);
});

router.get('/:id/weights', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const weights = db.prepare(
    'SELECT * FROM weights WHERE animal_id = ? ORDER BY date DESC, id DESC'
  ).all(req.params.id);
  res.json(weights);
});

router.post('/:id/weights', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const { weight_kg, date, notes } = req.body;
  const normalizedWeight = Number(weight_kg);
  if (weight_kg === undefined || weight_kg === null || !Number.isFinite(normalizedWeight) || normalizedWeight <= 0) {
    return res.status(422).json({ error: 'weight_kg must be a positive number' });
  }
  if (!date) {
    return res.status(422).json({ error: 'date is required' });
  }

  const result = db.prepare(
    'INSERT INTO weights (animal_id, weight_kg, date, notes) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, normalizedWeight, date, notes ?? null);

  const weight = db.prepare('SELECT * FROM weights WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(weight);
});

module.exports = router;
