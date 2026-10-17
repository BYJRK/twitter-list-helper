import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const page = await readFile('dist/page.js', 'utf8');
for (const partial of [false, true]) test(`page layer loads ${partial ? 'partial' : 'complete'} management directory without stale variables`, async () => {
  const window = new Window({ url: 'https://x.com/alice', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  const calls: { operation: string; variables: any; features: any }[] = [];
  window.document.cookie = 'twid=u%3D10; path=/';
  window.document.cookie = 'ct0=test-csrf; path=/';
  const scope = window as any;
  let member = true;
  scope.fetch = async (input: any, init: any) => {
    const url = new URL(String(input), 'https://x.com');
    const operation = url.pathname.split('/').at(-1)!;
    calls.push({ operation, variables: JSON.parse(url.searchParams.get('variables') ?? '{}'), features: JSON.parse(url.searchParams.get('features') ?? '{}') });
    if (operation === 'ListAddMember' || operation === 'ListRemoveMember') {
      if (init?.method === 'POST') {
        const payload = JSON.parse(init.body);
        assert.equal(payload.variables.listId, '7');
        assert.equal(payload.variables.userId, '42');
        member = operation === 'ListAddMember';
      }
      return new window.Response(JSON.stringify({ data: { list: { id_str: '7', user_results: { result: null } } }, errors: [{ code: 214, message: 'DecodeException [214]', path: ['list', 'user_results', 'result'] }] }), { status: 200 });
    }
    const data = url.pathname.endsWith('/lists/memberships.json') ? { lists: member ? [{ id_str: '7', mode: 'private' }] : [], next_cursor_str: '0' } : operation === 'UserByScreenName'
      ? { data: { user: { result: { rest_id: '42', core: { screen_name: 'alice' } } } } }
      : { data: { viewer: { lists_management_timeline: { timeline: { instructions: [{ entries: [{ content: { items: [{ item: { itemContent: { list: { id_str: '7', name: 'AI', user_results: { result: { rest_id: '10' } } } } } }] } }] }] } } } } };
    if (partial && operation === 'ListsManagementPageTimeline') Object.assign(data, { errors: [{ code: 214, message: 'BadRequest: com.twitter.strato.serialization.DecodeException [214]', path: ['viewer', 'recommendations'] }] });
    return new window.Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    window.eval(page);
    const auth = { authorization: 'Bearer test-public-token' };
    await scope.fetch('https://x.com/i/api/graphql/native-user/UserByScreenName?variables=%7B%22screen_name%22%3A%22alice%22%7D', { headers: auth });
    // Allow the cloned native response to populate the in-page identity cache.
    await new Promise(resolve => setTimeout(resolve, 30));
    const native = new URL('https://x.com/i/api/graphql/native-list/ListsManagementPageTimeline');
    native.searchParams.set('variables', JSON.stringify({ userId: '10', isListMemberTargetUserId: '99', withExtraField: true, cursor: 'old-cursor' }));
    native.searchParams.set('features', JSON.stringify({ current_flag: false }));
    await scope.fetch(native.href, { headers: auth });
    // Seed descriptors through observed requests; GET does not mutate this fixture.
    for (const name of ['ListAddMember', 'ListRemoveMember']) await scope.fetch(`https://x.com/i/api/graphql/native-write/${name}?variables=%7B%7D`, { headers: auth });
    calls.length = 0;
    const result = await scope.__xListHelperV1.run({ action: 'load', screenName: 'alice' });
    assert.equal(result.ok, true, result.error);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.operation, 'ListsManagementPageTimeline');
    assert.equal(calls[0]?.variables.isListMemberTargetUserId, undefined);
    assert.equal(calls[0]?.variables.isListMembershipShown, undefined);
    assert.equal(calls[0]?.variables.userId, undefined);
    assert.equal(calls[0]?.variables.count, 100);
    assert.equal(calls[1]?.operation, 'memberships.json');
    assert.equal(calls[0]?.variables.withExtraField, undefined);
    assert.equal(calls[0]?.variables.cursor, undefined);
    assert.equal(calls[0]?.features.current_flag, false);
    assert.equal(result.value.lists[0].member, true);
    if (partial) {
      assert.match(result.value.warnings[0], /目录可能不完整/);
      const diagnostic = JSON.parse(scope.__xListHelperV1.diagnostics());
      assert.equal(diagnostic.helperRequests[0].result.directory.validOwned, 1);
      assert.match(diagnostic.helperRequests[0].result.error, /DecodeException/);
    } else assert.equal(result.value.warnings, undefined);
    assert.equal(JSON.stringify(result).includes('test-csrf'), false);
    for (const desired of [false, true]) {
      calls.length = 0;
      const saved = await scope.__xListHelperV1.run({ action: 'toggle', screenName: 'alice', accountId: '10', userId: '42', listId: '7', member: desired });
      assert.equal(saved.ok, true, saved.error);
      assert.equal(saved.value.lists[0].member, desired);
      assert.deepEqual(calls.map(call => call.operation), [desired ? 'ListAddMember' : 'ListRemoveMember', 'memberships.json']);
    }
  } finally { await window.happyDOM.abort(); window.close(); }
});
test('page layer exposes operation and sanitized GraphQL failure details', async () => {
  const window = new Window({ url: 'https://x.com/alice', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  window.document.cookie = 'twid=u%3D10; path=/';
  window.document.cookie = 'ct0=test-csrf; path=/';
  const scope = window as any;
  scope.fetch = async () => new window.Response(JSON.stringify({ errors: [{ message: 'Required variable is missing', code: 336 }] }), { status: 200 });
  try {
    window.eval(page);
    await scope.fetch('https://x.com/i/api/graphql/current-id/UserByScreenName?variables=%7B%7D', { headers: { authorization: 'Bearer captured-token' } });
    const result = await scope.__xListHelperV1.run({ action: 'load', screenName: 'alice' });
    assert.equal(result.ok, false);
    assert.match(result.error, /UserByScreenName; request/);
    assert.match(result.error, /Required variable is missing/);
    assert.ok(!result.error.includes('captured-token'));
  } finally { await window.happyDOM.abort(); window.close(); }
});

for (const source of ['timeline', 'hover', 'initial', 'missing', 'preview']) test(`fresh page reads ${source} without guessing feature switches`, async () => {
  const window = new Window({ url: source === 'preview' ? 'https://x.com/home' : 'https://x.com/alice', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  const scope = window as any;
  let now = Date.now();
  const OriginalDate = scope.Date;
  scope.Date = class extends OriginalDate { static now() { return now; } };
  window.document.cookie = 'twid=u%3D10; path=/';
  window.document.cookie = 'ct0=test-csrf; path=/';
  const calls: string[] = [];
  const user = { rest_id: '42', core: { screen_name: 'alice' } };
  window.document.head.innerHTML = '<script src="https://abs.twimg.com/responsive-web/client-web/main.fixture.js"></script>';
  if (source === 'initial') scope.__INITIAL_STATE__ = { entities: { users: { entities: { '42': { id_str: '42', screen_name: 'alice' } } } } };
  scope.fetch = async (input: any) => {
    const url = new URL(String(input), 'https://x.com');
    if (url.hostname === 'abs.twimg.com') return new window.Response('queryId:"user-id",operationName:"UserByScreenName",metadata:{featureSwitches:["subscriptions_feature_can_gift_premium"]};queryId:"list-id",operationName:"ListsManagementPageTimeline",metadata:{featureSwitches:[]}');
    const operation = url.pathname.split('/').at(-1)!;
    calls.push(operation);
    let data: any;
    if (operation === 'HomeTimeline') data = { data: { home: { tweets: source === 'timeline' ? [{ core: { user_results: { result: user } } }] : [] } } };
    else if (operation === 'UserByRestId') data = { data: { user: { result: user } } };
    else if (operation === 'ListsManagementPageTimeline') data = { data: { viewer: { timeline: { instructions: [{ entries: [{ content: { itemContent: { list: { id_str: '7', name: 'AI', user_results: { result: { rest_id: '10' } } } } } }] }] } } } };
    else if (operation === 'memberships.json') {
      if (source === 'preview') {
        assert.equal(url.searchParams.get('screen_name'), 'alice');
        assert.equal(url.searchParams.get('user_id'), null);
        assert.equal(url.searchParams.get('filter_to_owned_lists'), 'true');
      } else assert.equal(url.searchParams.get('user_id'), '42');
      data = { lists: [{ id_str: '7' }], next_cursor_str: '0' };
    } else throw new Error(`Unexpected request ${operation}`);
    return new window.Response(JSON.stringify(data), { status: 200 });
  };
  try {
    window.eval(page);
    const auth = { authorization: 'Bearer native-auth' };
    await scope.fetch('https://x.com/i/api/graphql/home-id/HomeTimeline?variables=%7B%7D&features=%7B%7D', { headers: auth });
    await new Promise(resolve => setTimeout(resolve, 30));
    const pending = scope.__xListHelperV1.run({ action: source === 'preview' ? 'preview' : 'load', screenName: 'alice' });
    if (source === 'hover') {
      await new Promise(resolve => setTimeout(resolve, 150));
      await scope.fetch('https://x.com/i/api/graphql/hover-id/UserByRestId?variables=%7B%7D', { headers: auth });
    }
    const result = await pending;
    const diagnostic = JSON.parse(scope.__xListHelperV1.diagnostics());
    if (source === 'missing') {
      assert.equal(result.ok, false);
      assert.match(result.error, /UserByScreenName; prepare/);
      const failure = diagnostic.helperRequests.find((value: any) => value.operation === 'UserByScreenName');
      assert.equal(failure.stage, 'prepare');
      assert.match(failure.result.error, /subscriptions_feature_can_gift_premium/);
      assert.ok(!result.error.includes('左侧'));
    } else {
      assert.equal(result.ok, true, result.error);
      assert.equal(result.value.lists[0].member, true);
      assert.equal(calls.filter(name => name === 'ListsManagementPageTimeline').length, 1);
      assert.ok(diagnostic.nativeRequests.some((value: any) => value.operation === 'HomeTimeline'));
      if (source === 'preview') {
        assert.equal(result.value.userId, '');
        assert.ok(diagnostic.helperRequests.some((value: any) => value.operation === 'lists/memberships' && value.variables.screen_name === '[string]'));
        now += 600_000; // All former user/snapshot cache TTLs have elapsed; no new native user request arrives.
        const returned = await scope.__xListHelperV1.run({ action: 'preview', screenName: 'alice' });
        assert.equal(returned.ok, true, returned.error);
        assert.equal(returned.value.lists[0].member, true);
        assert.equal(calls.filter(name => name === 'memberships.json').length, 2);
        assert.equal(calls.filter(name => name === 'ListsManagementPageTimeline').length, 2);
      }
    }
    assert.equal(calls.includes('UserByScreenName'), false);
    assert.ok(!JSON.stringify(diagnostic).includes('native-auth'));
  } finally { await window.happyDOM.abort(); window.close(); }
});
