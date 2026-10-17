import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeUsers } from '../src/users';

test('native timeline and card identities support current, legacy and initial-store users', () => {
  const data = { timeline: [{ tweet: { rest_id: '999', core: { user_results: { result: { rest_id: '42', core: { screen_name: 'Alice' } } } } } }, { user: { result: { rest_id: '43', legacy: { screen_name: 'bob' } } } }], entities: { carol: { id_str: '44', screen_name: 'carol' } } };
  assert.deepEqual([...nativeUsers(data)], [['alice', '42'], ['bob', '43'], ['carol', '44']]);
});
test('incomplete native users and unsafe numeric IDs are never inferred', () => {
  assert.equal(nativeUsers([{ rest_id: '42' }, { screen_name: 'alice' }, { id: 42, screen_name: 'alice' }, { rest_id: '42', core: { screen_name: 'invalid handle' } }, { rest_id: 42, screen_name: 'alice' }]).size, 0);
});
