export const styles = `
:host{display:block;margin:12px 0;color:var(--xlh-fg,#0f1419);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--xlh-bg:#fff;--xlh-fg:#0f1419;--xlh-muted:#536471;--xlh-line:#cfd9de;--xlh-hover:#f7f9f9;--xlh-accent:#1d9bf0}
:host([dark]){--xlh-bg:#15202b;--xlh-fg:#f7f9f9;--xlh-muted:#a5b3c0;--xlh-line:#425364;--xlh-hover:#22303e}
:host([toolbar]){margin:var(--xlh-control-offset,0px) 8px 0 0;display:flex;align-self:flex-start;min-width:0;max-width:220px;flex:0 1 auto}:host([toolbar]) .wrap{min-width:0;max-width:100%}:host([toolbar]) .trigger{height:var(--xlh-control-height,36px);min-height:0;padding:0 12px}:host([toolbar]) .chevron{flex-shrink:0}@media(max-width:500px){:host([toolbar]){max-width:140px}}
*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;color:inherit}button:focus-visible,input:focus-visible{outline:2px solid var(--xlh-accent);outline-offset:3px}button:disabled{cursor:wait;opacity:.55}
.wrap{position:relative} .trigger{border:1px solid var(--xlh-line);border-radius:999px;background:var(--xlh-bg);padding:7px 14px;font-weight:650;max-width:100%;text-align:left;display:flex;align-items:center;gap:8px}.trigger:hover,.row:hover,.tool:hover{background:var(--xlh-hover)}.list-icon{width:20px;height:20px;fill:currentColor;flex-shrink:0}.caption{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chevron{color:var(--xlh-muted)}
.panel{position:fixed;inset:auto;margin:0;left:12px;top:12px;width:340px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);z-index:2147483647;color:var(--xlh-fg);font:14px/1.5 system-ui,sans-serif;background:var(--xlh-bg);border:1px solid var(--xlh-line);border-radius:14px;box-shadow:0 8px 32px #0003;overflow:auto;display:flex;flex-direction:column}.panel[hidden]{display:none}.panel::backdrop{background:transparent}.head{padding:14px 14px 10px;flex-shrink:0}.title{font-size:16px;font-weight:750}.hint{font-size:12px;color:var(--xlh-muted);margin:3px 0 10px}.search{width:100%;min-width:0;outline-offset:1px!important;border:1px solid var(--xlh-line);border-radius:9px;background:var(--xlh-bg);color:inherit;padding:7px 10px}.items{max-height:300px;min-height:0;overflow-y:auto;flex:1 1 auto}.item{display:flex;align-items:center;padding:0 6px}.row{border:0;background:transparent;display:flex;align-items:center;gap:8px;padding:9px 8px;flex:1;min-width:0;text-align:left;border-radius:8px}.mark{color:var(--xlh-accent);font-size:18px;width:22px;flex-shrink:0}.name{overflow-wrap:anywhere}.private{font-size:11px;color:var(--xlh-muted);margin-left:5px}.star{border:0;background:transparent;color:var(--xlh-muted);padding:9px;font-size:18px}.star[aria-pressed=true]{color:#df9b16}.empty{padding:16px 14px;color:var(--xlh-muted)}.foot{border-top:1px solid var(--xlh-line);padding:8px 10px;display:flex;justify-content:space-between;flex-shrink:0;background:var(--xlh-bg);position:sticky;bottom:0}.tool{border:0;background:transparent;border-radius:8px;padding:6px 8px;color:var(--xlh-accent);font-weight:600}.status{font-size:12px;color:var(--xlh-muted);padding:0 14px 8px;overflow-wrap:anywhere;flex-shrink:0}.status:empty{display:none}.status.error{color:#d44747}.diagnostics{font-size:12px;color:var(--xlh-muted);padding:0 14px 10px;max-height:150px;overflow:auto;flex-shrink:0}.diagnostics[hidden]{display:none}.diagnostics summary{cursor:pointer}.diagnostics pre{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.diagnostics .tool{font-size:12px;padding:3px 0}
`;
export function listIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  // Reuse only vector geometry from X's own sidebar, without its IDs, styles or handlers.
  const native = document.querySelector<SVGSVGElement>('a[data-testid="AppTabBar_Lists_Link"] svg, header a[href$="/lists"] svg');
  icon.setAttribute('viewBox', native?.getAttribute('viewBox') ?? '0 0 24 24');
  icon.setAttribute('class', 'list-icon');
  icon.setAttribute('aria-hidden', 'true');
  for (const original of native?.querySelectorAll('path') ?? []) {
    const path = document.createElementNS(ns, 'path');
    for (const key of ['d', 'fill-rule', 'clip-rule', 'transform']) {
      const value = original.getAttribute(key);
      if (value) path.setAttribute(key, value);
    }
    icon.append(path);
  }
  if (!icon.childElementCount) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M3 2h18v20H3V2zm2 2v16h14V4H5zm2 3h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z');
    icon.append(path);
  }
  return icon;
}
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
