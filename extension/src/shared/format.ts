// Экранирование для безопасной вставки в DOM/innerHTML и проверка href.
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export const escapeHtml = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

export const safeHref = (href: string): string | null =>
  /^https?:\/\//i.test(String(href || '')) ? String(href) : null;
