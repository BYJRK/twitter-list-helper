import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const content = await readFile('dist/content.js', 'utf8');
async function until(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error('UI condition timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function setup(emptyMembership = false, ownProfile = false) {
  // Only our locally built bundle is evaluated; no page resources or external scripts are loaded.
  const window = new Window({ url: 'https://x.com/alice', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  const calls: any[] = [];
  const saved: Record<string, any> = {};
  const listeners: Function[] = [];
  let failWrite = false;
  let failRead = false;
  let members = false;
  let partial = false;
  let blockLoad: ((value: any) => void) | undefined;
  const snapshot = (name = 'alice') => ({ accountId: '10', userId: name === 'alice' ? '42' : '43', screenName: name, fetchedAt: Date.now(), ...(partial ? { warnings: ['目录可能不完整'] } : {}), lists: [
    { id: '1', name: '<img src=x onerror=alert(1)>', member: members, private: false },
    { id: '2', name: '私密列表', member: true, private: true },
    { id: '3', name: '未知列表', member: null, private: false }
  ].map(list => emptyMembership ? { ...list, member: false } : list) });
  (window as any).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: saved[key] }),
        set: async (value: any) => { Object.assign(saved, value); for (const listener of listeners) listener(Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, { newValue }])), 'local'); }
      }, onChanged: { addListener: (listener: Function) => listeners.push(listener) }
    },
    runtime: { sendMessage: async (message: any) => {
      calls.push(message);
      const request = message.request;
      if (!request) return;
      if (request.action === 'load' && failRead) return { ok: false, error: '[ListsManagementPageTimeline; request] X 接口错误（HTTP 200）：The following features cannot be null: feature_a' };
      if (request.action === 'toggle') {
        if (failWrite) return { ok: false, error: '保存请求中断，请刷新状态。' };
        members = request.member;
      }
      if (request.action === 'load' && blockLoad) return new Promise(resolve => { blockLoad = resolve; });
      return { ok: true, value: snapshot(request.screenName) };
    } }
  };
  window.document.cookie = 'twid=u%3D10; path=/';
  window.document.body.innerHTML = '<main data-testid="primaryColumn"><div id="profile-actions"><div><button data-testid="userActions">更多</button></div><div><button data-testid="sendDMFromProfile">私信</button></div><div><button data-testid="42-follow">关注</button></div></div><div data-testid="UserName">Alice @alice</div><div>Biography</div><article><button data-testid="userActions">帖子菜单</button></article></main>';
  if (ownProfile) window.document.getElementById('profile-actions')!.innerHTML = '<div><a role="button" data-testid="editProfileButton">编辑个人资料</a></div>';
  window.eval(content);
  return { window, calls, saved, snapshot, partial: () => { partial = true; }, fail: () => { failWrite = true; }, failRead: () => { failRead = true; }, block: () => { blockLoad = () => {}; }, resolve: (value: any) => blockLoad?.(value), shadow: () => window.document.getElementById('x-list-helper')?.shadowRoot };
}

test('profile toolbar prepends the helper and restores it after X replaces the row', async () => {
  const s = setup();
  try {
    await until(() => !!s.shadow()?.querySelector('.row'));
    const toolbar = s.window.document.getElementById('profile-actions')!;
    assert.equal(toolbar.firstElementChild?.id, 'x-list-helper');
    assert.equal(toolbar.firstElementChild?.hasAttribute('toolbar'), true);
    const readCount = s.calls.length;
    toolbar.innerHTML = '<div><button data-testid="userActions">更多</button></div><div><button data-testid="42-follow">关注</button></div>';
    await until(() => toolbar.firstElementChild?.id === 'x-list-helper');
    assert.equal(s.calls.length, readCount);
    assert.equal(s.window.document.querySelectorAll('#x-list-helper').length, 1);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});

test('known empty membership shows the short caption', async () => {
  const s = setup(true);
  try {
    await until(() => !!s.shadow()?.querySelector('.row'));
    assert.equal(s.shadow()!.querySelector('.caption')!.textContent, '未加入列表');
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});

test('own profile keeps the empty membership button mounted in the edit toolbar', async () => {
  const s = setup(true, true);
  try {
    await until(() => !!s.shadow()?.querySelector('.row'));
    const host = s.window.document.getElementById('x-list-helper')!;
    const toolbar = s.window.document.querySelector('[data-testid="editProfileButton"]')!.parentElement!;
    assert.equal(host.parentElement, toolbar);
    let moves = 0;
    const observer = new s.window.MutationObserver(records => {
      for (const record of records) if ([...record.removedNodes].includes(host)) moves++;
    });
    observer.observe(s.window.document.body, { childList: true, subtree: true });
    // Allow multiple debounced mutation scans and an explicit focus scan.
    s.window.dispatchEvent(new s.window.Event('focus'));
    await new Promise(resolve => setTimeout(resolve, 650));
    observer.disconnect();
    assert.equal(moves, 0, 'the helper must not alternate between the toolbar and profile name');
    assert.equal(s.window.document.getElementById('x-list-helper'), host);
    assert.equal(host.parentElement, toolbar);
    assert.equal(s.shadow()!.querySelector('.caption')!.textContent, '未加入列表');
    assert.equal(s.calls.filter(call => call.request?.action === 'load').length, 1);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});

test('partial directory warns and does not overwrite the stored complete directory', async () => {
  const s = setup();
  try {
    await until(() => !!s.saved['account:10']);
    const savedDirectory = JSON.stringify(s.saved['account:10']);
    s.partial();
    const root = s.shadow()!;
    (root.querySelector('.foot .tool') as any).click();
    await until(() => !!root.querySelector('.status')?.textContent.includes('目录可能不完整'));
    assert.equal(JSON.stringify(s.saved['account:10']), savedDirectory);
    assert.match(root.querySelector('.diagnostics pre')!.textContent, /目录可能不完整/);
    assert.equal(root.querySelectorAll('.row:not(:disabled)').length, 2);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});
test('UI renders membership, treats names as text, saves favorites and performs one write', async () => {
  const s = setup();
  try {
    await until(() => !!s.shadow()?.querySelector('.row'));
    const root = s.shadow()!;
    assert.match(root.querySelector('.caption')!.textContent, /私密列表/);
    assert.equal(root.querySelectorAll('img').length, 0);
    assert.equal(root.querySelectorAll('.row[aria-checked="mixed"]')[0]?.getAttribute('disabled'), '');
    const trigger = root.querySelector('button.trigger') as any;
    trigger.click();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    const row = [...root.querySelectorAll('.row')].find(row => row.textContent.includes('<img')) as any;
    row.click();
    await until(() => s.calls.some(c => c.request?.action === 'toggle') && !root.querySelector('.status')?.textContent.includes('保存'));
    assert.equal(s.calls.filter(c => c.request?.action === 'toggle').length, 1);
    assert.equal([...root.querySelectorAll('.row')].find(row => row.textContent.includes('<img'))?.getAttribute('aria-checked'), 'true');
    (root.querySelector('.star') as any).click();
    await until(() => !!s.saved.settings);
    assert.equal(s.saved.settings.favorites['10'].length, 1);
    root.dispatchEvent(new s.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(s.saved['account:10'].lists.some((item: any) => 'member' in item), false);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});
test('failed writes retain previous checks and disable mutations until refresh', async () => {
  const s = setup();
  try {
    await until(() => !!s.shadow()?.querySelector('.row'));
    s.fail();
    const root = s.shadow()!;
    ([...root.querySelectorAll('.row')].find(row => row.textContent.includes('<img')) as any).click();
    await until(() => !!root.querySelector('.status.error'));
    assert.equal([...root.querySelectorAll('.row')].find(row => row.textContent.includes('<img'))?.getAttribute('aria-checked'), 'false');
    assert.equal(root.querySelectorAll('.row:not(:disabled)').length, 0);
    (root.querySelector('.foot .tool') as any).click();
    await until(() => root.querySelectorAll('.row:not(:disabled)').length > 0);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});
test('SPA changes remove stale profile UI; similarly named profiles do not match', async () => {
  const s = setup();
  try {
    await until(() => !!s.shadow()?.querySelector('.row'));
    s.window.history.pushState({}, '', '/alice2');
    s.window.dispatchEvent(new s.window.PopStateEvent('popstate'));
    await until(() => !s.shadow());
    s.window.history.pushState({}, '', '/bob');
    s.window.document.querySelector('[data-testid="UserName"]')!.textContent = 'Bob @bob';
    s.window.dispatchEvent(new s.window.PopStateEvent('popstate'));
    await until(() => s.calls.some(c => c.request?.screenName === 'bob'));
    await until(() => !!s.shadow()?.querySelector('.row'));
    s.window.history.pushState({}, '', '/bob/status/123');
    s.window.dispatchEvent(new s.window.PopStateEvent('popstate'));
    await until(() => !s.shadow());
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});
test('read errors stay inside the bounded menu with details and a refresh button', async () => {
  const s = setup();
  try {
    await until(() => !!s.shadow()?.querySelector('.row'));
    s.failRead();
    const root = s.shadow()!;
    (root.querySelector('.foot .tool') as any).click();
    await until(() => !!root.querySelector('.status.error'));
    assert.equal(root.querySelector('.status.error')!.parentElement, root.querySelector('.panel'));
    assert.ok(!root.querySelector('.status.error')!.textContent.includes('feature_a'));
    assert.match(root.querySelector('.diagnostics pre')!.textContent, /ListsManagementPageTimeline.*feature_a/);
    assert.equal(root.querySelector('.panel')!.getAttribute('popover'), 'manual');
    (root.querySelector('.trigger') as any).click();
    assert.equal((root.querySelector('.panel') as any).style.position, '');
    assert.ok((root.querySelector('.panel') as any).style.maxHeight.endsWith('px'));
    assert.equal(root.querySelector('.foot')!.parentElement, root.querySelector('.panel'));
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});
