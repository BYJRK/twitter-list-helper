import type { ApiRequest, ApiResult } from './types';
import './page-types';

function allowedUrl(value?: string): boolean {
  try { const url = new URL(value!); return url.protocol === 'https:' && ['x.com', 'twitter.com'].includes(url.hostname); } catch { return false; }
}
function validRequest(request: any): request is ApiRequest {
  if (!request || typeof request !== 'object' || typeof request.screenName !== 'string' || !/^[\w]{1,15}$/.test(request.screenName)) return false;
  if (request.action === 'load' || request.action === 'preview') return request.force === undefined || typeof request.force === 'boolean';
  return request.action === 'toggle' && ['accountId', 'userId', 'listId'].every(key => typeof request[key] === 'string' && /^\d+$/.test(request[key])) && typeof request.member === 'boolean';
}
chrome.action.onClicked.addListener(() => { void chrome.runtime.openOptionsPage(); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || !allowedUrl(sender.url)) return;
  if (message?.type === 'options') { void chrome.runtime.openOptionsPage(); return; }
  if (message?.type === 'diagnostics') {
    void chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, world: 'MAIN', func: () => window.__xListHelperV1?.diagnostics() ?? '页面诊断不可用，请刷新 X 页面。' })
      .then(results => sendResponse(results[0]?.result ?? '页面诊断不可用。')).catch(() => sendResponse('无法读取诊断，请刷新 X 页面。'));
    return true;
  }
  if (message?.type !== 'api' || !validRequest(message.request)) return;
  void (async () => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: sender.tab!.id! }, world: 'MAIN',
        func: async (request: ApiRequest): Promise<ApiResult> => {
          if (!window.__xListHelperV1) return { ok: false, error: '扩展已更新，请刷新 X 页面后再试。' };
          return window.__xListHelperV1.run(request);
        }, args: [message.request]
      });
      sendResponse(results[0]?.result ?? { ok: false, error: '页面已切换，请刷新后重试。' });
    } catch { sendResponse({ ok: false, error: '无法连接页面，请刷新 X 页面后重试。' }); }
  })();
  return true;
});
