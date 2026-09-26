import type { Deck, DeckConfig, Prefs } from './types';

export const DEFAULT_DECK_CONFIG: DeckConfig = {
  newPerDay: 20,
  reviewsPerDay: 250,
  desiredRetention: 0.9,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  maximumInterval: 36500,
  newOrder: 'added',
  autoSpeak: true,
  typeAnswer: false,
  burySiblings: true,
  leechThreshold: 8,
};

export const DEFAULT_PREFS: Omit<Prefs, 'updatedAt'> = {
  id: 'global',
  dailyGoal: 50,
  rolloverHour: 4,
  reminderTime: '19:00',
  defaultProvider: 'claude',
  level: 'A2',
  nativeLanguage: 'English',
};

export function withPrefDefaults(p: Partial<Prefs> | undefined): Prefs {
  return { ...DEFAULT_PREFS, updatedAt: 0, ...(p ?? {}) } as Prefs;
}

/** Resolve a deck's effective config: defaults ← ancestors' overrides ← own overrides. */
export function resolveDeckConfig(deck: Deck | undefined, byId: Map<string, Deck>): DeckConfig {
  const chain: Deck[] = [];
  const seen = new Set<string>();
  let cur = deck;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  const cfg: DeckConfig = { ...DEFAULT_DECK_CONFIG };
  for (const d of chain) {
    if (!d.config) continue;
    for (const [k, v] of Object.entries(d.config)) {
      if (v !== undefined && v !== null) (cfg as unknown as Record<string, unknown>)[k] = v;
    }
  }
  cfg.desiredRetention = Math.min(0.99, Math.max(0.7, cfg.desiredRetention));
  return cfg;
}
