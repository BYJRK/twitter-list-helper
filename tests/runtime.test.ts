import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeOperations } from '../src/runtime';
test('native module capabilities do not force feature switches or field toggles true', () => {
  const previous = (globalThis as any).window;
  const factory = function() { return { queryId: 'test-id', operationName: 'ListsManagementPageTimeline', metadata: { featureSwitches: ['flag_on', 'flag_off'], fieldToggles: ['withExtraFields'] } }; };
  const require: any = () => ({ default: factory() });
  require.m = { example: factory };
  const chunks: any = [];
  chunks.push = (chunk: any) => chunk[2](require);
  (globalThis as any).window = { webpackChunkFixture: chunks };
  try {
    const operation = nativeOperations().get('ListsManagementPageTimeline');
    assert.deepEqual(operation?.requiredFeatures, ['flag_on', 'flag_off']);
    assert.deepEqual(operation?.features, {});
    assert.deepEqual(operation?.fieldToggles, {});
  } finally { (globalThis as any).window = previous; }
});
