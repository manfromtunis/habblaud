// Read-only store for the public Office: holds the snapshot the page gives it and tells the world.
// No network code: the public page fetches office-public.json itself.
import type { AgentInfo, OfficeSnapshot } from '../../../shared/types';
import type { StoreEvents } from './store';

type Listener<K extends keyof StoreEvents> = (value: StoreEvents[K]) => void;

export class PublicStore {
  snapshot: OfficeSnapshot | null = null;
  private listeners = new Map<keyof StoreEvents, Set<(value: never) => void>>();

  on<K extends keyof StoreEvents>(event: K, cb: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb as (value: never) => void);
    return () => void set.delete(cb as (value: never) => void);
  }

  show(snap: OfficeSnapshot): void {
    this.snapshot = snap;
    for (const cb of this.listeners.get('snapshot') ?? []) (cb as Listener<'snapshot'>)(snap);
  }

  agent(id: string): AgentInfo | undefined {
    return this.snapshot?.agents.find((a) => a.id === id);
  }
}
