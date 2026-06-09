// Ссылки на сторы для review-ссылки в футере (per-browser). Иконки — src/public/store/*.
// URL пустые до публикации: getStoreInfo вернёт null → review-ссылка скрыта (намётка готова,
// после публикации проставить ID/слаги и ссылка появится сама).
export interface StoreInfo {
  url: string;
  icon: string;
  label: string;
}

const STORES: Record<string, StoreInfo> = {
  chrome: {
    url: '', // TODO: https://chromewebstore.google.com/detail/<id>/reviews
    icon: '/store/chrome.svg',
    label: 'Chrome Web Store',
  },
  edge: {
    url: '', // TODO: https://microsoftedge.microsoft.com/addons/detail/<id>
    icon: '/store/edge.svg',
    label: 'Edge Add-ons',
  },
  firefox: {
    url: '', // TODO: https://addons.mozilla.org/firefox/addon/<slug>/
    icon: '/store/mozilla.svg',
    label: 'Firefox Add-ons',
  },
};

// Edge запускает chrome-сборку → отличаем по UA; Firefox — по сборочному флагу.
function detectBrowser(): string {
  if (import.meta.env.FIREFOX) return 'firefox';
  return /\bEdg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
}

export function getStoreInfo(): StoreInfo | null {
  const info = STORES[detectBrowser()] ?? null;
  return info && info.url ? info : null; // нет URL → не показываем мёртвую ссылку
}
