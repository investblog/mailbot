import { applyI18n, lang } from '@shared/i18n';
import { initTheme } from '@shared/theme';

document.documentElement.lang = lang();
initTheme();
applyI18n();
