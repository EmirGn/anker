// Android integration: back button, deep links (anker://pair?...), status bar.
import { desktop } from './desktop';
import { isNative } from './platform';
import { navigate } from './router';

export async function initNative() {
  desktop?.onNavigate((route) => navigate(route));
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    const h = window.location.hash.replace(/^#/, '') || '/';
    if (h === '/' || h === '') void App.minimizeApp();
    else history.back();
  });
  await App.addListener('appUrlOpen', ({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'anker:' && (u.host === 'pair' || u.pathname.includes('pair'))) {
        navigate(`/connect?${u.searchParams.toString()}`);
      }
    } catch {
      // ignore malformed links
    }
  });
  try {
    const { StatusBar } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // ignore
  }
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    await Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
  } catch {
    // ignore
  }
}
