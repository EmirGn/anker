import { Empty } from '../components/ui';
import { ArtikelBlitz } from './Artikel';
import { Diktat } from './Diktat';
import { Kasus } from './Kasus';
import { Uhrzeit } from './Uhrzeit';
import { Verben } from './Verben';
import { Zahlen } from './Zahlen';
import { tr } from '../lib/i18n';

export function Drill({ game }: { game: string }) {
  switch (game) {
    case 'artikel':
      return <ArtikelBlitz />;
    case 'zahlen':
      return <Zahlen />;
    case 'uhrzeit':
      return <Uhrzeit />;
    case 'kasus':
      return <Kasus />;
    case 'verben':
      return <Verben />;
    case 'diktat':
      return <Diktat />;
    default:
      return <Empty title={tr('Unbekanntes Spiel')} />;
  }
}
