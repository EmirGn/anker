import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.emirgn.anker',
  appName: 'Anker',
  webDir: 'dist',
  android: {
    // The app (https://localhost) talks to your Mac's hub over plain http on the LAN.
    allowMixedContent: true,
  },
  plugins: {
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
    LocalNotifications: { smallIcon: 'ic_stat_anker', iconColor: '#E3972C' },
    Keyboard: { resizeOnFullScreen: true },
  },
};

export default config;
