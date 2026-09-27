import { Capacitor } from '@capacitor/core';
import { desktop } from './desktop';

export const isNative = Capacitor.isNativePlatform();
export const isAndroid = Capacitor.getPlatform() === 'android';
export const isDesktop = !!desktop;
export const platformName: 'mac' | 'android' | 'web' = isDesktop ? 'mac' : isAndroid ? 'android' : 'web';
export const isMacLike = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMacLike ? '⌘' : 'Ctrl';

// ------------------------------------------------------------------ haptics
export async function haptic(kind: 'tap' | 'success' | 'warning' | 'error' = 'tap') {
  if (!isNative) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
    if (kind === 'tap') await Haptics.impact({ style: ImpactStyle.Light });
    else
      await Haptics.notification({
        type: kind === 'success' ? NotificationType.Success : kind === 'warning' ? NotificationType.Warning : NotificationType.Error,
      });
  } catch {
    // no haptics available
  }
}

// ------------------------------------------------------------------ reminders
export async function scheduleDailyReminder(time: string | null): Promise<boolean> {
  if (isDesktop) {
    desktop!.setReminder(time);
    return true;
  }
  if (!isNative) return false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: 4747 }] });
    if (!time) return true;
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return false;
    const [hour, minute] = time.split(':').map(Number) as [number, number];
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 4747,
          title: 'Zeit für Deutsch',
          body: 'Deine Karten warten. Ein paar Minuten halten deine Serie am Leben.',
          schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
          smallIcon: 'ic_stat_anker',
        },
      ],
    });
    return true;
  } catch (e) {
    console.warn('reminder failed', e);
    return false;
  }
}

export function setBadge(count: number) {
  desktop?.setBadge(count);
}

export function openExternal(url: string) {
  if (desktop) desktop.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

export function deviceName(): string {
  if (isAndroid) {
    const m = navigator.userAgent.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/);
    return m?.[1]?.trim() ? `${m[1].trim()} (Android)` : 'Android phone';
  }
  if (/iPhone|iPad/.test(navigator.userAgent)) return 'iPhone';
  return `${isMacLike ? 'Mac' : 'Computer'} browser`;
}
