import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/publishCache.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { createPublishCache } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const realNow = Date.now;
let now = 1000;
Date.now = () => now;
try {
  const cache = createPublishCache(60_000, 2);
  let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([cache.get('task', load), cache.get('task', load)]), [1, 1]);
  assert.equal(await cache.get('task', load), 1);
  assert.equal(calls, 1, 'Repeated expansion reuses data and deduplicates pending requests');
  now += 60_001;
  assert.equal(await cache.get('task', load), 2, 'Expired data is fetched again');
  cache.clear();
  assert.equal(await cache.get('task', load), 3, 'Refresh invalidates cached data');
  let finish;
  const pending = cache.get('late', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  cache.clear();
  finish('old');
  await pending;
  assert.equal(cache.read('late'), undefined, 'Old responses cannot repopulate cleared caches');
  await assert.rejects(cache.get('failed', async () => { throw new Error('offline'); }));
  assert.equal(await cache.get('failed', async () => 'recovered'), 'recovered', 'Failures can be retried');
  cache.write('second', 2);
  cache.write('third', 3);
  assert.equal(cache.read('failed'), undefined, 'Cache memory is bounded');
  assert.equal(createPublishCache().read('third'), undefined, 'Separate page/identity caches are isolated');
  console.log('PASS: reuse, request deduplication, expiry, refresh, stale responses, retry, capacity, isolation');
} finally {
  Date.now = realNow;
}
