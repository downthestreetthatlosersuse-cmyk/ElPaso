import { useSyncExternalStore } from "react";

export type GameState = "menu" | "playing" | "paused" | "gameover";

export interface FeedItem {
  id: number;
  text: string;
  color: string;
}

export interface Hud {
  state: GameState;
  health: number;
  mag: number;
  reserve: number;
  weapon: string;
  weaponSlot: number;
  reloading: boolean;
  score: number;
  kills: number;
  wave: number;
  enemiesLeft: number;
  combo: number;
  best: number;
  bannerId: number;
  bannerText: string;
  bannerSub: string;
  feed: FeedItem[];
  hitId: number;
  dmgId: number;
}

const loadBest = (): number => {
  try {
    return Number(localStorage.getItem("elpaso-meltdown-best") || 0) || 0;
  } catch {
    return 0;
  }
};

let s: Hud = {
  state: "menu",
  health: 100,
  mag: 32,
  reserve: 160,
  weapon: "RATTLER SMG",
  weaponSlot: 0,
  reloading: false,
  score: 0,
  kills: 0,
  wave: 0,
  enemiesLeft: 0,
  combo: 0,
  best: loadBest(),
  bannerId: 0,
  bannerText: "",
  bannerSub: "",
  feed: [],
  hitId: 0,
  dmgId: 0,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
let feedSeq = 0;

export const hud = {
  get: (): Hud => s,
  set(p: Partial<Hud>) {
    s = { ...s, ...p };
    emit();
  },
  banner(text: string, sub = "") {
    s = { ...s, bannerId: s.bannerId + 1, bannerText: text, bannerSub: sub };
    emit();
  },
  feed(text: string, color: string) {
    const id = ++feedSeq;
    s = { ...s, feed: [...s.feed.slice(-4), { id, text, color }] };
    emit();
    setTimeout(() => {
      s = { ...s, feed: s.feed.filter((f) => f.id !== id) };
      emit();
    }, 2800);
  },
  hit() {
    s = { ...s, hitId: s.hitId + 1 };
    emit();
  },
  dmg() {
    s = { ...s, dmgId: s.dmgId + 1 };
    emit();
  },
  saveBest(score: number) {
    if (score > s.best) {
      s = { ...s, best: score };
      try {
        localStorage.setItem("elpaso-meltdown-best", String(score));
      } catch {
        /* ignore */
      }
      emit();
    }
  },
  subscribe(f: () => void) {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  },
};

export function useHud(): Hud {
  return useSyncExternalStore(hud.subscribe, hud.get);
}
