/** Bridge exposed by the Electron preload script (Mac app). */
export interface AnkerDesktop {
  hubUrl: string;
  token: string;
  version: string;
  platform: string;
  setBadge(count: number): void;
  notify(title: string, body: string): void;
  setReminder(time: string | null): void;
  openExternal(url: string): void;
  onNavigate(cb: (route: string) => void): void;
  closeQuickAdd(): void;
  getSettings(): Promise<{ openAtLogin: boolean; shortcut: string }>;
  setOpenAtLogin(open: boolean): Promise<void>;
  setShortcut(accelerator: string): Promise<boolean>;
  /** Menu, tray and notification language (older builds lack it). */
  setLanguage?(lang: 'en' | 'de'): Promise<void>;
  /** Microphone access for voice chat (asks macOS the first time; older builds lack it). */
  askMicrophone?(): Promise<boolean>;
}

declare global {
  interface Window {
    ankerDesktop?: AnkerDesktop;
  }
}

export const desktop: AnkerDesktop | undefined = typeof window !== 'undefined' ? window.ankerDesktop : undefined;
