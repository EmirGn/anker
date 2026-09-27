import { dayStartMs, DAY, reviewsByDay, streak } from '@anker/core';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Layout } from './components/Layout';
import { Spinner, Toaster } from './components/ui';
import { db, getMeta } from './lib/db';
import { useDeckCounts, useDecks, useLiveQuery, usePrefs, useSyncState } from './lib/hooks';
import { setBadge } from './lib/platform';
import { match, navigate, useRoute } from './lib/router';
import { Browse } from './pages/Browse';
import { Connect } from './pages/Connect';
import { DeckPage } from './pages/DeckPage';
import { Decks } from './pages/Decks';
import { Editor } from './pages/Editor';
import { More } from './pages/More';
import { Practice } from './pages/Practice';
import { QuickAdd } from './pages/QuickAdd';
import { Settings } from './pages/Settings';
import { Study } from './pages/Study';
import { Today } from './pages/Today';
import { Tutor } from './pages/Tutor';
import { Welcome } from './pages/Welcome';

const Stats = lazy(() => import('./pages/Stats').then((m) => ({ default: m.Stats })));
const Grammar = lazy(() => import('./pages/Grammar').then((m) => ({ default: m.Grammar })));
const ImportPage = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPage })));
const Drill = lazy(() => import('./drills/Drill').then((m) => ({ default: m.Drill })));

function useOnboardingRedirect() {
  const decks = useDecks();
  const sync = useSyncState();
  const { path } = useRoute();
  useEffect(() => {
    // Only from the Today page, so "Import from Anki" etc. still work for brand-new users.
    if (!decks || decks.length > 0 || path !== '/') return;
    if (sync.status === 'syncing' || (sync.status === 'idle' && !sync.lastSync)) return;
    void getMeta('onboarded', false).then((done) => {
      if (!done) navigate('/welcome', { replace: true });
    });
  }, [decks, sync.status, sync.lastSync, path]);
}

export function App() {
  const { path } = useRoute();
  const prefs = usePrefs();
  const decks = useDecks();
  const counts = useDeckCounts();
  const since = useMemo(() => dayStartMs(Date.now(), prefs.rolloverHour) - 400 * DAY, [prefs.rolloverHour]);
  const recentLogs = useLiveQuery(() => db.revlog.where('review').above(since).toArray(), [since]);
  useOnboardingRedirect();

  const due = useMemo(() => {
    if (!decks || !counts) return 0;
    let n = 0;
    for (const d of decks) {
      if (d.parentId && decks.some((p) => p.id === d.parentId)) continue;
      const c = counts.get(d.id);
      if (c) n += c.new + c.learn + c.review;
    }
    return n;
  }, [decks, counts]);

  const streakNow = useMemo(() => {
    if (!recentLogs) return 0;
    return streak(reviewsByDay(recentLogs, prefs.rolloverHour), Date.now(), prefs.rolloverHour).current;
  }, [recentLogs, prefs.rolloverHour]);

  useEffect(() => setBadge(due), [due]);

  let page: React.ReactNode;
  let m: Record<string, string> | null;
  if (path === '/') page = <Today due={due} />;
  else if (path === '/decks') page = <Decks />;
  else if ((m = match('/decks/:id', path))) page = <DeckPage id={m.id!} />;
  else if (path === '/study') page = <Study deckId={null} />;
  else if ((m = match('/study/:deck', path))) page = <Study deckId={m.deck!} />;
  else if (path === '/add') page = <Editor key="add" />;
  else if ((m = match('/edit/:id', path))) page = <Editor key={m.id} noteId={m.id!} />;
  else if (path === '/browse') page = <Browse />;
  else if (path === '/practice') page = <Practice />;
  else if ((m = match('/practice/:game', path))) page = <Drill game={m.game!} />;
  else if (path === '/tutor') page = <Tutor chatId={null} />;
  else if ((m = match('/tutor/:id', path))) page = <Tutor chatId={m.id!} />;
  else if (path === '/stats') page = <Stats />;
  else if (path === '/grammar') page = <Grammar topic={null} />;
  else if ((m = match('/grammar/:topic', path))) page = <Grammar topic={m.topic!} />;
  else if (path === '/settings') page = <Settings />;
  else if (path === '/connect') page = <Connect />;
  else if (path === '/welcome') page = <Welcome />;
  else if (path === '/quick-add') page = <QuickAdd />;
  else if (path === '/import') page = <ImportPage />;
  else if (path === '/more') page = <More />;
  else page = <Today due={due} />;

  if (path === '/quick-add') {
    return (
      <>
        {page}
        <Toaster />
      </>
    );
  }

  return (
    <>
      <Layout due={due} streak={streakNow}>
        <Suspense
          fallback={
            <div className="flex h-64 items-center justify-center">
              <Spinner />
            </div>
          }
        >
          {page}
        </Suspense>
      </Layout>
      <Toaster />
    </>
  );
}
