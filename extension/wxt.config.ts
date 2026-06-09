import { defineConfig } from 'wxt';
import { resolve } from 'node:path';

// MailBot extension — второй клиент email-core. Popup-inbox, polling, device-token auth.
// Один codebase → Chrome/Edge (MV3) + Firefox (MV2) через WXT.
export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',

  vite: () => ({
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  }),

  manifest: ({ browser }) => ({
    name: 'MailBot — Disposable email',
    description: 'Disposable email addresses with OTP detection, right in your browser.',
    homepage_url: 'https://mailbot.click',

    // Доступ только к нашему API (CORS на сервере = *). notifications — нотификации/Web Push.
    // Chrome/Edge: push (SW) + sidePanel, alarms не нужен. Firefox: push невозможен →
    // closed-state на alarm-поллинге, поэтому alarms; sidePanel у FF нет (sidebar_action).
    permissions: browser === 'firefox'
      ? ['storage', 'notifications', 'alarms']
      : ['storage', 'notifications', 'sidePanel'],
    host_permissions: ['https://api.mailbot.click/*'],

    icons: {
      16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png', 256: 'icon/256.png',
    },

    // Один popup.html служит и popup, и боковой панелью (?sidepanel=1).
    action: {
      default_title: 'MailBot',
      default_popup: 'popup.html',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },

    ...(browser !== 'firefox' && {
      side_panel: { default_path: 'popup.html?sidepanel=1' },
    }),

    ...(browser === 'firefox' && {
      sidebar_action: {
        default_panel: 'popup.html?sidepanel=1',
        default_title: 'MailBot',
        default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' },
      },
      browser_specific_settings: {
        gecko: { id: 'mailbot@mailbot.click', strict_min_version: '115.0' },
      },
    }),
  }),

  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      // Firefox AMO H1 2026 требует data_collection_permissions.
      if (manifest.browser_specific_settings?.gecko) {
        (manifest.browser_specific_settings.gecko as Record<string, unknown>)
          .data_collection_permissions = { required: ['none'] };
      }
    },
  },

  browser: 'chrome',
});
