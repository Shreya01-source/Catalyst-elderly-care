const request = require('supertest');
const app = require('../server');

describe('CareCircle API Tests', () => {
  test('POST /api/profile/login succeeds with valid demo passcode', async () => {
    const res = await request(app).post('/api/profile/login').send({ id: 'demo-elder', passcode: '123456' });
    expect(res.statusCode).toBe(200);
    expect(res.body.elderName).toBe('Ramesh Kumar');
  });

  test('POST /api/profile/login rejects invalid passcode', async () => {
    const res = await request(app).post('/api/profile/login').send({ id: 'demo-elder', passcode: '000000' });
    expect(res.statusCode).toBe(401);
  });
});
