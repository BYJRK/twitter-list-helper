import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLists, parseUser, profileName, collectLists, checkApiResponse, checkDirectoryResponse, directoryIncomplete, extractOperations, apiErrorDetails, collectMemberships, parseMembershipPage, operationFeatures } from '../src/core';
import { readSettings, readAccount } from '../src/types';

export function timeline(lists: any[], cursor?: string, terminate = false): any {
  return { data: { user: { result: { timeline: { timeline: { instructions: [
    { type: 'TimelineAddEntries', entries: lists.map(list => ({ content: { itemContent: { list_results: { result: list } } } })).concat(cursor ? [{ content: { cursorType: 'Bottom', value: cursor } } as any] : []) },
    ...(terminate ? [{ type: 'TimelineTerminateTimeline', direction: 'Bottom' }] : [])
  ] } } } } } };
}
test('profile routes exclude tweets, followers and reserved pages', () => {
  for (const path of ['/home', '/i/lists', '/alice/status/1', '/alice/followers', '/search', '/alice/media/more']) assert.equal(profileName(path), null);
  assert.equal(profileName('/Alice/media'), 'Alice');
  assert.equal(profileName('/alice/'), 'alice');
});
test('user lookup accepts old and new field paths without using another user', () => {
  assert.equal(parseUser({ data: { user: { result: { rest_id: '42', core: { screen_name: 'Alice' } } } } }, 'alice'), '42');
  assert.throws(() => parseUser({ rest_id: '5', legacy: { screen_name: 'Bob' } }, 'alice'));
});
test('unknown membership is not false; another account lists are excluded', () => {
  const result = parseLists(timeline([
    { id_str: '1', name: '私密', mode: 'Private', is_member: true, user_results: { result: { rest_id: '10' } } },
    { rest_id: '2', name: '<script>', is_member: false },
    { id_str: '3', name: 'unknown' },
    { id_str: '4', name: 'other', user: { id_str: '99' } }
  ]), '10');
  assert.deepEqual(result.lists.map(l => l.member), [true, false, null]);
  assert.equal(result.lists[0]?.private, true);
  assert.throws(() => parseLists({ data: {} }, '10'), /响应格式/);
});
test('legacy list containers and replace entries are read', () => {
  const data = { data: { user: { result: { timeline: { instructions: [{ type: 'TimelineReplaceEntry', entry: { content: { itemContent: { list: { id_str: '7', name: 'old', is_member: false } } } } }] } } } } };
  assert.equal(parseLists(data, '10').lists[0]?.id, '7');
});
test('pagination includes all pages, deduplicates and respects termination', async () => {
  const calls: (string | undefined)[] = [];
  const result = await collectLists(async cursor => {
    calls.push(cursor);
    return cursor ? timeline([{ id_str: '1', name: 'A', is_member: true }, { id_str: '2', name: 'B', is_member: false }], 'ignored', true) : timeline([{ id_str: '1', name: 'A', is_member: true }], 'next');
  }, '10');
  assert.deepEqual(calls, [undefined, 'next']);
  assert.equal(result.length, 2);
});
test('repeated cursor fails instead of displaying a truncated success', async () => {
  await assert.rejects(collectLists(async () => timeline([], 'same'), '10'), /重复分页/);
});
test('HTTP 200 GraphQL errors, rate limits and malformed success are rejected', () => {
  assert.throws(() => checkApiResponse(200, { data: { list: {} }, errors: [{ message: 'failed' }] }));
  assert.throws(() => checkApiResponse(429, {}), /频率/);
  assert.throws(() => checkApiResponse(200, {}));
  checkApiResponse(200, { data: { list: {} } });
});
test('bundle metadata supplies operation IDs and feature switches', () => {
  const found = extractOperations('queryId:"new-query-id",operationName:"ListsManagementPageTimeline",operationType:"query",metadata:{featureSwitches:["flag_a","flag_b"]}');
  assert.equal(found.get('ListsManagementPageTimeline')?.id, 'new-query-id');
  assert.deepEqual(found.get('ListsManagementPageTimeline')?.requiredFeatures, ['flag_a', 'flag_b']);
  assert.equal(found.get('ListsManagementPageTimeline')?.features, undefined);
});
test('stored settings and account directory are validated', () => {
  assert.deepEqual(readSettings({ display: 'bad', favorites: { '10': ['1', 2, 'bad'], bad: ['2'] } }), { display: 'names', favorites: { '10': ['1'] } });
  assert.equal(readAccount({ lists: [] }), null);
});
test('GraphQL errors retain actionable feature names and redact credentials', () => {
  const data = { errors: [{ code: 336, message: 'The following features cannot be null: feature_a, feature_b. authorization=secret auth_token=private ct0=token Bearer hidden https://example.com/secret' }] };
  const detail = apiErrorDetails(data);
  assert.match(detail, /feature_a, feature_b/);
  assert.match(detail, /336/);
  assert.ok(!detail.includes('secret') && !detail.includes('private') && !detail.includes('hidden') && !detail.includes('token'));
  assert.throws(() => checkApiResponse(200, data), /feature_a/);
});
test('membership pagination preserves large cursor strings and private list IDs', async () => {
  const calls: string[] = [];
  const result = await collectMemberships(async cursor => {
    calls.push(cursor);
    return cursor === '-1' ? { lists: [{ id_str: '7', mode: 'private' }], next_cursor_str: '12345678901234567890' } : { lists: [{ id_str: '8' }, { id_str: '7' }], next_cursor_str: '0' };
  });
  assert.deepEqual(calls, ['-1', '12345678901234567890']);
  assert.deepEqual(result, ['7', '8']);
});
test('malformed or incomplete membership responses are never treated as an empty set', () => {
  assert.throws(() => parseMembershipPage({ lists: [] }), /分页/);
  assert.throws(() => parseMembershipPage({ next_cursor_str: '0' }), /响应格式/);
  assert.throws(() => parseMembershipPage({ lists: [{ id: 9007199254740999 }], next_cursor_str: '0' }), /准确/);
  assert.deepEqual(parseMembershipPage({ lists: [], next_cursor_str: '0' }), { ids: [], cursor: undefined });
});
test('repeated membership cursor fails instead of declaring incomplete results', async () => {
  await assert.rejects(collectMemberships(async () => ({ lists: [], next_cursor_str: '-1' })), /重复/);
});
test('management directory filters subscribed lists and reads owned modules across pages', async () => {
  const page = (ownId: string, cursor?: string) => ({ data: { viewer: { lists_management_timeline: { timeline: { instructions: [{ entries: [
    { content: { items: [
      { item: { itemContent: { list: { id_str: '99', name: '订阅别人的列表', user_results: { result: { rest_id: '88' } } } } } },
      { item: { itemContent: { list: { id_str: ownId, name: '我的列表', mode: 'Private', user_results: { result: { rest_id: '10' } } } } } }
    ] } }, ...(cursor ? [{ content: { cursorType: 'Bottom', value: cursor } }] : [])
  ] }] } } } } });
  const result = await collectLists(async cursor => cursor ? page('8') : page('7', 'next'), '10', 'management');
  assert.deepEqual(result.map(list => list.id), ['7', '8']);
  assert.equal(result[0]?.private, true);
});
test('management directory with unknown list ownership is not exposed for editing', () => {
  assert.throws(() => parseLists(timeline([{ id_str: '7', name: 'unknown owner' }]), '10', 'management'), /所有者/);
});
test('feature capabilities never enable flags; actual user config overrides defaults', () => {
  const operation = { id: 'test', source: 'bundle' as const, requiredFeatures: ['flag_a', 'flag_b'] };
  const flags = operationFeatures(operation, {}, { featureSwitch: { defaultConfig: { flag_a: { value: true }, flag_b: { value: true } }, user: { config: { flag_b: { value: false } } } } }, {});
  assert.deepEqual(flags, { flag_a: true, flag_b: false });
  assert.throws(() => operationFeatures(operation, {}, undefined, {}), /真实功能开关/);
});
test('captured native features are used exactly, including false values', () => {
  assert.deepEqual(operationFeatures({ id: 'test', source: 'request', features: { flag_a: false } }, { flag_a: true, extra: true }, undefined, {}), { flag_a: false });
});
test('partial directory decoding errors recover only independently valid owned records', () => {
  const data = timeline([
    { id_str: '7', name: 'Owned', user_results: { result: { rest_id: '10' } } },
    { id_str: '8', name: 'Broken recommendation', user_results: { result: null } }
  ]);
  data.errors = [{ code: 214, message: 'BadRequest: com.twitter.strato.serialization.DecodeException', path: ['user', 'result', 'timeline', 'timeline', 'instructions', 0, 'entries', 1, 'user_results', 'result'] }];
  checkDirectoryResponse(200, data, '10');
  assert.equal(parseLists(data, '10', 'management', true).lists.length, 1);
  // The same policy must never confirm mutations or accept a server/auth failure.
  assert.throws(() => checkApiResponse(200, data));
  assert.throws(() => checkDirectoryResponse(403, data, '10'));
  assert.throws(() => checkDirectoryResponse(500, data, '10'));
});
test('partial responses without valid owned lists or with unrelated errors remain failures', () => {
  const data = timeline([{ id_str: '7', name: 'Other', user_results: { result: { rest_id: '99' } } }]);
  data.errors = [{ code: 214, message: 'DecodeException' }];
  assert.throws(() => checkDirectoryResponse(200, data, '10'));
  const own = timeline([{ id_str: '7', name: 'Owned', user_results: { result: { rest_id: '10' } } }]);
  own.errors = [{ code: 226, message: 'Account restricted' }];
  assert.throws(() => checkDirectoryResponse(200, own, '10'));
});

test('optional list-field errors do not imply an incomplete directory', () => {
  const data = timeline([{ id_str: '7', name: 'Owned', user_results: { result: { rest_id: '10' } }, attached_user: { result: null } }]);
  const prefix = ['user', 'result', 'timeline', 'timeline', 'instructions', 0, 'entries', 0, 'content', 'itemContent', 'list_results', 'result'];
  for (const suffix of [['attached_user', 'result'], ['description'], ['legacy', 'description'], ['user_results', 'result', 'avatar']]) {
    data.errors = [{ code: 214, message: 'DecodeException', path: [...prefix, ...suffix] }];
    assert.equal(directoryIncomplete(data, '10'), false, suffix.join('.'));
    checkDirectoryResponse(200, data, '10');
    assert.throws(() => checkApiResponse(200, data));
  }
});

test('identity, ownership, record and pagination errors retain directory warnings', () => {
  const data = timeline([{ id_str: '7', name: 'Owned', user_results: { result: { rest_id: '10' } } }], 'next');
  const prefix = ['user', 'result', 'timeline', 'timeline', 'instructions', 0, 'entries'];
  const record = [...prefix, 0, 'content', 'itemContent', 'list_results', 'result'];
  for (const path of [undefined, [], [...record, 'name'], [...record, 'mode'], [...record, 'id_str'], [...record, 'user_results', 'result'], [...record, 'user_results', 'result', 'rest_id'], record, [...prefix, 1, 'content', 'value'], [...prefix, 9, 'content', 'itemContent', 'list']]) {
    data.errors = [{ code: 214, message: 'DecodeException', path }];
    assert.equal(directoryIncomplete(data, '10'), true, JSON.stringify(path));
  }
  const broken = timeline([{ id_str: '7', name: 'Owned', user_results: { result: { rest_id: '10' } } }, null]);
  broken.errors = [{ code: 214, message: 'DecodeException', path: [...record, 'description'] }];
  assert.equal(directoryIncomplete(broken, '10'), true);
});
