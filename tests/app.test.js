const request = require('supertest');
const app = require('../server');

describe('CareCircle AI Comprehensive Evaluation Suite', () => {
  test('GET /health returns 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /api/profile/login succeeds with valid demo passcode', async () => {
    const res = await request(app).post('/api/profile/login').send({ id: 'demo-elder', passcode: '123456' });
    expect(res.statusCode).toBe(200);
    expect(res.body.elderName).toBe('Ramesh Kumar');
    expect(res.body.passcodeHash).toBeUndefined();
  });

  test('POST /api/profile/login rejects invalid passcode', async () => {
    const res = await request(app).post('/api/profile/login').send({ id: 'demo-elder', passcode: '000000' });
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/profile/create validates input and creates hashed profile', async () => {
    const badRes = await request(app).post('/api/profile/create').send({ id: 'x', passcode: '12' });
    expect(badRes.statusCode).toBe(400);

    const uniqueId = `elder-${Date.now()}`;
    const res = await request(app).post('/api/profile/create').send({
      id: uniqueId, elderName: 'Lakshmi Devi', passcode: '9876', caregiverEmail: 'care@example.com'
    });
    expect(res.statusCode).toBe(201);
  });

  test('Medication CRUD, adherence toggle, missed flag, and deletion work', async () => {
    const add = await request(app).post('/api/profile/demo-elder/medications').send({
      name: 'Vitamin D3', time: '01:00 PM', instructions: 'Take after lunch'
    });
    expect(add.statusCode).toBe(201);
    const medId = add.body.id;

    const miss = await request(app).patch(`/api/profile/demo-elder/medications/${medId}/miss`);
    expect(miss.statusCode).toBe(200);
    expect(miss.body.missed).toBe(true);

    const take = await request(app).patch(`/api/profile/demo-elder/medications/${medId}/toggle`);
    expect(take.statusCode).toBe(200);
    expect(take.body.taken).toBe(true);
    expect(take.body.missed).toBe(false);

    const del = await request(app).delete(`/api/profile/demo-elder/medications/${medId}`);
    expect(del.statusCode).toBe(200);
  });

  test('POST /api/profile/:id/appointments schedules a doctor visit', async () => {
    const res = await request(app).post('/api/profile/demo-elder/appointments').send({
      doctor: 'Dr. Arun Rao', date: '2026-12-01 09:00 AM', location: 'City Clinic'
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.doctor).toBe('Dr. Arun Rao');
  });

  test('POST /api/ai/simplify returns plain-language instructions', async () => {
    const res = await request(app).post('/api/ai/simplify').send({
      instructions: 'Administer 1 tablet PO postprandial'
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.simplified).toBeDefined();
  });
});
