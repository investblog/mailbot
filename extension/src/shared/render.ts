// Безопасный рендер тела письма из токенов: текст экранируем, ссылки строим сами (только http/https).
import { escapeHtml, safeHref } from './format';
import type { Token } from './types';

export function renderBody(tokens: Token[]): string {
  if (!tokens || !tokens.length) return '';
  return tokens
    .map((tok) => {
      if (tok.type === 'link') {
        const href = safeHref(tok.href);
        if (!href) return escapeHtml(tok.label || '');
        const label = escapeHtml((tok.label || '').slice(0, 80) || href);
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
      return escapeHtml(tok.value);
    })
    .join('');
}
