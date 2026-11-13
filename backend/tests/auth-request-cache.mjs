// Read-only integration check against local data; no account or task mutations.
import 'dotenv/config';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { prisma } from '../dist/src/shared/prisma.js';
import { createApp } from '../dist/src/app.js';

assert(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
const identity = await prisma.userIdentity.findFirstOrThrow({ where: {
  roleCode: 'HALL_MANAGER', status: 'active', user: { status: 'active' }, org: { status: 'active' },
} });
let counts = {};
prisma.$use(async (params, next) => {
  const key = `${params.model}.${params.action}`;
  counts[key] = (counts[key] ?? 0) + 1;
  return next(params);
});
const server = createApp().listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const root = `http://127.0.0.1:${server.address().port}/api`;
const headers = {
  Authorization: `Bearer ${jwt.sign({ userId: identity.userId }, process.env.JWT_SECRET, { expiresIn: '2m' })}`,
  'X-Identity-Id': identity.id,
};
async function check(path, requestHeaders, status) {
  counts = {};
  const response = await fetch(root + path, { headers: requestHeaders });
  await response.json();
  assert.equal(response.status, status, path);
}
try {
  for (let n = 0; n < 2; n++) {
    await check('/tasks/report/hall-daily-dashboard', headers, 200);
    assert.equal(counts['User.findFirst'], 1);
    assert.equal(counts['UserIdentity.findFirst'], 1);
  }
  await check('/tasks/report/hall-daily-dashboard', {}, 401);
  await check('/tasks/report/hall-daily-dashboard', { ...headers, Authorization: 'Bearer invalid' }, 401);
  await check('/tasks/report/hall-daily-dashboard', { ...headers, 'X-Identity-Id': 'nonexistent' }, 403);
  await check('/organization-statistics-groups/test', headers, 403);
  console.log('PASS: one user/identity query per request; fresh checks on next request; unauthenticated, invalid token, invalid identity and forbidden permissions rejected');
} finally {
  server.close();
  await prisma.$disconnect();
}
