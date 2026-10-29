// Gameplay settings a phone named ADMIN_NAME can change from its settings menu.
// The TV is the authority: it applies changes, sends them back to the admin phones
// and asks the server to save them (settings.json), so they survive restarts and
// both TV pages share them. `values` is what's in play, `defaults` is what the
// Default button goes back to, and FACTORY is what's written here.

export const ADMIN_NAME = "ingo";

export interface SettingDef {
  key: string;
  group: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  bool?: boolean; // shown as an on/off switch, stored as 0 / 1
}

export const SETTINGS: SettingDef[] = [
  { key: "speedFast", group: "Ground speed", label: "Light grey", min: 0, max: 400, step: 5, def: 140, unit: "px/s" },
  { key: "speedNormal", group: "Ground speed", label: "Grey, blue, green", min: 0, max: 400, step: 5, def: 90, unit: "px/s" },
  { key: "speedSlow", group: "Ground speed", label: "Dark grey", min: 0, max: 400, step: 5, def: 40, unit: "px/s" },
  { key: "speedBlack", group: "Ground speed", label: "Black", min: 0, max: 200, step: 1, def: 8, unit: "px/s" },

  { key: "shipTurn", group: "Ships", label: "Turn rate", min: 0.5, max: 10, step: 0.1, def: 3.4, unit: "rad/s" },
  { key: "shipSize", group: "Ships", label: "Size", min: 0.4, max: 2.5, step: 0.05, def: 1, unit: "×" },
  { key: "trailLife", group: "Ships", label: "Trail (0 = off)", min: 0, max: 10, step: 0.5, def: 4, unit: "s" },

  { key: "fireCooldown", group: "Bullets", label: "Time between shots", min: 0, max: 10, step: 0.1, def: 2, unit: "s" },
  { key: "bulletSpeed", group: "Bullets", label: "Speed", min: 50, max: 1000, step: 10, def: 280, unit: "px/s" },

  { key: "shrapnelCount", group: "Shrapnel", label: "Pieces", min: 0, max: 32, step: 1, def: 8 },
  { key: "shrapnelSpeed", group: "Shrapnel", label: "Speed", min: 50, max: 1000, step: 10, def: 340, unit: "px/s" },
  { key: "shrapnelLife", group: "Shrapnel", label: "Range", min: 0.1, max: 5, step: 0.1, def: 1.2, unit: "s" },

  { key: "cells", group: "Map", label: "Polygons (from next lobby)", min: 15, max: 300, step: 1, def: 72 },
  { key: "moveFast", group: "Map", label: "Light grey movement", min: 0, max: 200, step: 1, def: 40, unit: "px/s" },
  { key: "moveDanger", group: "Map", label: "Red movement", min: 0, max: 200, step: 1, def: 55, unit: "px/s" },
  { key: "showSites", group: "Map", label: "Show polygon dots", min: 0, max: 1, step: 1, def: 1, bool: true },

  { key: "timeScale", group: "Game", label: "Time limit", min: 0.3, max: 3, step: 0.05, def: 1, unit: "×" },

  { key: "music", group: "Sound", label: "Music", min: 0, max: 1, step: 1, def: 1, bool: true },
  { key: "musicVolume", group: "Sound", label: "Music volume", min: 0, max: 100, step: 5, def: 60, unit: "%" },
];

export type Values = Record<string, number>;

export const FACTORY: Values = {};
for (const s of SETTINGS) FACTORY[s.key] = s.def;

// The live values. Game and Course read these every frame.
export const settings: Values = { ...FACTORY };

// Keeps known keys only, clamped to their range. Missing ones come from `base`.
export function clean(input: unknown, base: Values): Values {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Values = {};
  for (const s of SETTINGS) {
    const v = Number(src[s.key]);
    out[s.key] = isFinite(v) && src[s.key] !== null && src[s.key] !== "" ? Math.min(s.max, Math.max(s.min, v)) : base[s.key];
  }
  return out;
}

export const isAdmin = (name: string) => name.trim().toLowerCase() === ADMIN_NAME;
