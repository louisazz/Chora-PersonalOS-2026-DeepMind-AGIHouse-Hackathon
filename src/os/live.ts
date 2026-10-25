/** Bridge between the OS home screen and the core: the core publishes snapshots, the screen sends actions back. */
import type { ContextId, EventSource, SuggestedAction, WorldState } from '@/contract/types';

export type CardFlavor = 'concert' | 'boxing' | 'commute' | 'request' | 'change' | 'due' | 'other';

export interface LiveCard {
  /** suggestion id, `matter:<id>` for a quiet presence card, or the proposition id of an ask. */
  id: string;
  kind: 'suggestion' | 'ask';
  /** OS home domain id: music | fitness | work | learning | health | travel | other */
  domain: string;
  objectId?: string;
  title: string;
  sub: string;
  cta: string;
  urgency: number;
  conf: number;
  action?: SuggestedAction;
  /** Proposition texts the suggestion rests on. */
  because: string[];
  matterId?: string;
  flavor: CardFlavor;
  // ask cards
  propositionId?: string;
  sender?: string;
  text?: string;
  candidates?: { objectId: string; name: string; score: number }[];
}

export interface LiveMatter {
  id: string;
  name: string;
  /** Venue or short label used in rows. */
  short: string;
  domain: string;
  when?: string;
  whenLabel: string;
  place?: string;
  state: WorldState;
  people: string[];
  messages: { id: string; text: string; sender?: string; status: string }[];
  facts: { id: string; text: string }[];
  changed?: string;
  onSale?: string;
}

export interface LiveProposition {
  id: string;
  text: string;
  conf: number;
  status: string;
  about?: string;
  source: EventSource;
  sender?: string;
  kind: string;
}

export interface LiveEvent {
  band: string;
  dateLong: string;
  time: string;
  venue: string;
  onSale: string;
  distance: string;
}

export interface LiveSnapshot {
  ready: true;
  timeLabel: string;
  dateLabel: string;
  context: ContextId;
  band: string;
  cards: LiveCard[];
  matters: LiveMatter[];
  status: Partial<Record<string, string>>;
  activity: Record<string, { id: string; sources: string[] } | null>;
  propositions: LiveProposition[];
  silences: { title: string; reason: string }[];
  event?: LiveEvent;
  lastLog?: string;
}

export interface LiveApi {
  feed(input: { text: string; sender?: string; source: EventSource; app?: string }): Promise<string>;
  dismiss(suggestionId: string): void;
  execute(action: SuggestedAction): Promise<string>;
  resolveAsk(propositionId: string, objectId: string): void;
  openCorrection(propositionId: string): void;
  deleteProposition(id: string): void;
  freezeProposition(id: string): void;
}

export const live: { snapshot: LiveSnapshot | null; api: LiveApi | null; listeners: Set<() => void> } = {
  snapshot: null,
  api: null,
  listeners: new Set(),
};

export function connectLive(api: LiveApi): void {
  live.api = api;
}

export function publishLive(snapshot: LiveSnapshot): void {
  live.snapshot = snapshot;
  for (const l of live.listeners) l();
}

export function onLive(fn: () => void): () => void {
  live.listeners.add(fn);
  return () => live.listeners.delete(fn);
}
