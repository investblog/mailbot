import { browser } from 'wxt/browser';
import { applyI18n, lang } from '@shared/i18n';
import { initTheme } from '@shared/theme';

document.documentElement.lang = lang();
initTheme();
applyI18n();

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// --- open the side panel / sidebar straight from welcome ---
const sidePanel = (browser as { sidePanel?: { open(opts: { windowId?: number }): Promise<void> } }).sidePanel;
const sidebarAction = (browser as { sidebarAction?: { open(): Promise<void> } }).sidebarAction;

const btn = $('#open-panel');
if (sidePanel?.open || sidebarAction?.open) {
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    try {
      if (sidePanel?.open) {
        const w = await browser.windows.getCurrent();
        await sidePanel.open({ windowId: w.id });
      } else if (sidebarAction?.open) {
        await sidebarAction.open();
      }
    } catch { /* user can still use the toolbar icon */ }
  });
} else {
  $('#open-hint').hidden = false;
}
