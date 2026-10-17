import test from 'node:test';
import assert from 'node:assert/strict';
import { ListService, type Transport } from '../src/service';
import type { ApiRequest } from '../src/types';

const data = () => ({ data: { viewer: { lists_management_timeline: { timeline: { instructions: [{ entries: [{ content: { items: [{ item: { itemContent: { list: { id_str: '7', name: 'AI', is_member: false, user_results: { result: { rest_id: '10' } } } } } }] } }] }] } } } } });
function setup() {
  let account = '10'; let path = '/alice'; let now = 1;
  const calls: string[] = [];
  let write: () => Promise<any> = async () => ({ data: { list: { id_str: '7' } } });
  let memberships: (id: string) => Promise<string[]> = async () => [];
  let directory: () => any = data;
  const membershipCalls: string[] = [];
  const transport: Transport = { account: () => account, pathname: () => path, now: () => now, query: async (operation, vars) => {
    calls.push(operation);
    if (operation === 'UserByScreenName') return { data: { user: { result: { rest_id: vars.screen_name.toLowerCase() === 'bob' ? '43' : '42', core: { screen_name: vars.screen_name } } } } };
    if (operation === 'ListsManagementPageTimeline') { assert.equal(vars.userId, undefined); assert.equal(vars.isListMemberTargetUserId, undefined); assert.equal(vars.isListMembershipShown, undefined); assert.equal(vars.count, 100); return directory(); }
    return write();
  }, memberships: async id => { membershipCalls.push(id); return memberships(id); }, membershipsByScreenName: async name => {
    const id = name.toLowerCase() === 'bob' ? '43' : '42';
    membershipCalls.push(id); return memberships(id);
  } };
  return { service: new ListService(transport), calls, membershipCalls, account: (value: string) => account = value, path: (value: string) => path = value, time: (value: number) => now = value, write: (value: typeof write) => write = value, memberships: (value: typeof memberships) => memberships = value, directory: (value: typeof directory) => directory = value };
}
const load: ApiRequest = { action: 'load', screenName: 'alice' };
const toggle: ApiRequest = { action: 'toggle', screenName: 'alice', accountId: '10', userId: '42', listId: '7', member: true };

test('hover preview reads on the timeline but does not allow mutations there', async () => {
  const s = setup(); s.path('/home');
  const result = await s.service.run({ action: 'preview', screenName: 'alice' });
  assert.equal(result.screenName, 'alice');
  assert.equal(result.userId, '');
  assert.equal(s.calls.includes('UserByScreenName'), false);
  await assert.rejects(s.service.run(toggle), /已离开/);
  assert.equal(s.calls.filter(c => c === 'ListAddMember').length, 0);
  await s.service.run({ action: 'preview', screenName: 'alice' });
  assert.deepEqual(s.membershipCalls, ['42']);
});

test('preview snapshots cannot authorize profile mutations and can refresh without user IDs after absence', async () => {
  const s = setup();
  await s.service.run({ action: 'preview', screenName: 'alice' });
  await assert.rejects(s.service.run(toggle), /先刷新/);
  s.time(600_001);
  const refreshed = await s.service.run({ action: 'preview', screenName: 'alice' });
  assert.equal(refreshed.userId, '');
  assert.equal(s.calls.includes('UserByScreenName'), false);
  assert.equal(s.calls.includes('ListAddMember'), false);
  assert.deepEqual(s.membershipCalls, ['42', '42']);
  await s.service.run(load);
  assert.equal((await s.service.run(toggle)).userId, '42');
});

test('hover preview discards results after navigation or account change', async () => {
  for (const change of ['route', 'account']) {
    const s = setup(); s.path('/home');
    s.memberships(async () => { if (change === 'route') s.path('/explore'); else s.account('11'); return ['7']; });
    await assert.rejects(s.service.run({ action: 'preview', screenName: 'alice' }), /已切换/);
  }
});

test('different hovered users reuse directory but read separate memberships', async () => {
  const s = setup(); s.path('/home');
  await s.service.run({ action: 'preview', screenName: 'alice' });
  await s.service.run({ action: 'preview', screenName: 'Alice' });
  await s.service.run({ action: 'preview', screenName: 'bob' });
  s.time(31_000);
  await s.service.run({ action: 'preview', screenName: 'alice' });
  assert.equal(s.calls.filter(c => c === 'ListsManagementPageTimeline').length, 2);
  assert.deepEqual(s.membershipCalls, ['42', '43', '42']);
});

for (const member of [true, false]) test(`errored ${member ? 'add' : 'remove'} confirms actual membership with one read and no repeated write`, async () => {
  const s = setup();
  s.memberships(async () => member ? [] : ['7']);
  await s.service.run(load);
  s.write(async () => {
    s.memberships(async () => member ? ['7'] : []);
    throw new Error('[ListMutation] DecodeException [214]');
  });
  s.time(2000);
  const result = await s.service.run({ ...toggle, member });
  assert.equal(result.lists[0]?.member, member);
  assert.equal(result.fetchedAt, 2000);
  assert.equal(s.calls.filter(c => c === (member ? 'ListAddMember' : 'ListRemoveMember')).length, 1);
  assert.deepEqual(s.membershipCalls, ['42', '42']);
  assert.equal((await s.service.run(load)).lists[0]?.member, member);
});

test('failed verification preserves the mutation error and invalidates editing state', async () => {
  const s = setup(); await s.service.run(load);
  s.write(async () => { throw new Error('DecodeException [214]'); });
  s.memberships(async () => { throw new Error('read failed'); });
  await assert.rejects(s.service.run(toggle), /DecodeException.*\n保存后读取状态也失败：read failed/);
  await assert.rejects(s.service.run(toggle), /先刷新/);
  assert.equal(s.calls.filter(c => c === 'ListAddMember').length, 1);
});

test('account changes during post-write verification discard confirmation', async () => {
  const s = setup(); await s.service.run(load);
  s.write(async () => { throw new Error('DecodeException [214]'); });
  s.memberships(async () => { s.account('11'); return ['7']; });
  await assert.rejects(s.service.run(toggle), /账号已切换/);
});
test('only explicit toggles mutate, successful state updates and reads cache briefly', async () => {
  const { service, calls } = setup();
  await service.run(load); await service.run(load);
  assert.equal(calls.length, 2);
  const saved = await service.run(toggle);
  assert.equal(saved.lists[0]?.member, true);
  assert.equal(calls.at(-1), 'ListAddMember');
});
test('wrong account, user, list or page cannot trigger a write', async () => {
  const s = setup(); await s.service.run(load);
  for (const changed of [{ accountId: '99' }, { userId: '99' }, { listId: '99' }]) await assert.rejects(s.service.run({ ...toggle, ...changed }));
  s.path('/bob'); await assert.rejects(s.service.run(toggle));
  assert.equal(s.calls.length, 2);
});
test('account changes during reading discard the entire result', async () => {
  const s = setup(); s.account('11');
  await assert.rejects(s.service.run(toggle));
  assert.equal(s.calls.length, 0);
});
test('expired status requires refresh before writing', async () => {
  const s = setup(); await s.service.run(load); s.time(70_000);
  await assert.rejects(s.service.run(toggle), /过期/);
  assert.equal(s.calls.length, 2);
});
test('lost write response clears cache and is never automatically retried', async () => {
  const s = setup(); await s.service.run(load);
  s.write(async () => { throw new Error('response lost'); });
  await assert.rejects(s.service.run(toggle), /response lost/);
  await assert.rejects(s.service.run(toggle), /刷新/);
  await s.service.run(load);
  assert.equal(s.calls.filter(c => c === 'ListAddMember').length, 1);
  assert.equal(s.calls.filter(c => c === 'ListsManagementPageTimeline').length, 2);
});
test('missing mutation confirmation is not successful', async () => {
  const s = setup(); await s.service.run(load); s.write(async () => ({ data: {} }));
  await assert.rejects(s.service.run(toggle), /未确认/);
});
test('a different returned list ID cannot confirm a write', async () => {
  const s = setup(); await s.service.run(load); s.write(async () => ({ data: { list: { id_str: '99' } } }));
  await assert.rejects(s.service.run(toggle), /未确认/);
});
test('parallel writes are blocked and navigation during save discards stale UI result', async () => {
  const s = setup(); await s.service.run(load);
  let resolve!: (data: any) => void;
  s.write(() => new Promise(done => { resolve = done; }));
  const first = s.service.run(toggle);
  await assert.rejects(s.service.run(toggle), /正在保存/);
  s.path('/bob'); resolve({ data: { list: { id_str: '7' } } });
  await assert.rejects(first, /已离开/);
});
test('target-user memberships override directory flags without exposing lists owned by others', async () => {
  const s = setup();
  s.memberships(async () => ['7', '999']);
  const result = await s.service.run(load);
  assert.equal(result.lists.length, 1);
  assert.equal(result.lists[0]?.member, true);
  assert.deepEqual(s.membershipCalls, ['42']);
});
test('membership lookup failure is not converted to false', async () => {
  const s = setup(); s.memberships(async () => { throw new Error('membership endpoint failed'); });
  await assert.rejects(s.service.run(load), /membership endpoint failed/);
  await assert.rejects(s.service.run(toggle), /刷新/);
});
test('account switch during membership lookup discards the whole snapshot', async () => {
  const s = setup(); s.memberships(async () => { s.account('11'); return []; });
  await assert.rejects(s.service.run(load), /账号已切换/);
});
test('partial directory snapshots carry incompleteness warnings and still require complete memberships', async () => {
  const s = setup();
  s.directory(() => ({ ...data(), errors: [{ code: 214, message: 'DecodeException' }] }));
  const result = await s.service.run(load);
  assert.match(result.warnings?.[0] ?? '', /目录可能不完整/);
  assert.equal(result.lists[0]?.member, false);
  s.memberships(async () => { throw new Error('incomplete membership'); });
  await assert.rejects(s.service.run({ action: 'load', screenName: 'alice', force: true }), /incomplete membership/);
});

test('ancillary decoding errors suppress warnings across reused directory snapshots', async () => {
  const s = setup(); s.path('/home');
  s.directory(() => ({ ...data(), errors: [{ code: 214, message: 'DecodeException', path: ['viewer', 'lists_management_timeline', 'timeline', 'instructions', 0, 'entries', 0, 'content', 'items', 0, 'item', 'itemContent', 'list', 'attached_user', 'result'] }] }));
  const first = await s.service.run({ action: 'preview', screenName: 'alice' });
  assert.equal(first.warnings, undefined);
  const second = await s.service.run({ action: 'preview', screenName: 'bob' });
  assert.equal(second.warnings, undefined);
  assert.equal(s.calls.filter(c => c === 'ListsManagementPageTimeline').length, 1);
  assert.deepEqual(s.membershipCalls, ['42', '43']);
});
