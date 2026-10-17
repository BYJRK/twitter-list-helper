import test from 'node:test';
import assert from 'node:assert/strict';
import { requestDiagnostic, responseDiagnostic } from '../src/diagnostics';
test('diagnostics omit identities, cookies, raw values and nonboolean feature values', () => {
  const diagnostic = requestDiagnostic('ListsManagementPageTimeline', 'public-query-id', 'native', {
    variables: { userId: '123456789', screen_name: 'privateHandle', cursor: 'privateCursor', count: 100 },
    features: { real_flag: false, secret: 'hiddenToken' },
    fieldToggles: { withFoo: false }, headers: { authorization: 'Bearer privateToken', cookie: 'ct0=privateCsrf' }
  }, 'GET');
  const text = JSON.stringify(diagnostic);
  for (const secret of ['123456789', 'privateHandle', 'privateCursor', 'hiddenToken', 'privateToken', 'privateCsrf']) assert.ok(!text.includes(secret));
  assert.equal(diagnostic.features.real_flag, false);
  assert.equal(diagnostic.fieldToggles.withFoo, false);
  assert.equal(diagnostic.variables.count, 100);
});
test('response diagnostics retain outcome without copying profile or list contents', () => {
  const result = responseDiagnostic(200, { data: { viewer: { name: 'private-name' } }, errors: [{ code: 214, message: 'DecodeException' }] });
  assert.equal(result?.hasData, true);
  assert.match(result!.error, /214/);
  assert.ok(!JSON.stringify(result).includes('private-name'));
});
test('directory diagnostics expose error paths and owner categories without list identities', () => {
  const result = responseDiagnostic(200, {
    data: { viewer: { timeline: { instructions: [{ entries: [{ content: { itemContent: { list: { id_str: 'private-id', name: 'private-list', user_results: { result: { rest_id: 'private-account' } } } } } }] }] } } },
    errors: [{ code: 214, message: 'DecodeException', path: ['viewer', 'timeline', 'instructions', 0, 'private-handle'] }]
  }, 'private-account');
  assert.equal(result?.directory?.validOwned, 1);
  assert.deepEqual(result?.errorPaths[0], ['viewer', 'timeline', 'instructions', 0, '[field]']);
  for (const secret of ['private-id', 'private-list', 'private-account', 'private-handle']) assert.ok(!JSON.stringify(result).includes(secret));
});
