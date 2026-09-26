import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initHub } from './lib/hub';
import { initNative } from './lib/native';
import { startSyncLoop } from './lib/sync';
import { initTheme } from './lib/theme';
import './styles.css';

initTheme();
await initHub();
startSyncLoop();
void initNative();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
