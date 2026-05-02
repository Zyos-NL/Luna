import { Injectable, signal, computed, Signal } from '@angular/core';

export type AgeBand = 'young-adult' | 'adult' | 'mature';
export type BodyType = 'slim' | 'athletic' | 'curvy' | 'plus';
export type BreastSize = 'small' | 'medium' | 'large' | 'huge';
export type ButtSize = 'small' | 'medium' | 'large';

export interface Character {
  id: string;
  name: string;
  ethnicity?: string;
  ageBand?: AgeBand;
  hairColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  bodyType?: BodyType;
  breastSize?: BreastSize;
  buttSize?: ButtSize;
  personalityTags?: string[];
  defaultOutfit?: string;
  /** Filename inside ../lumi/models/luna-characters/<id>/ — set after
   *  Create-Identity finishes (see character-pipeline agent). */
  identityFilename?: string;
  /** Session-image filenames generated for this character — populated by
   *  workflow.service.ts when an image is saved. */
  photoHistory?: string[];
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'luna.characters';

@Injectable({ providedIn: 'root' })
export class CharacterService {
  private _characters = signal<Character[]>(this.load());
  readonly characters = this._characters.asReadonly();
  readonly activeCharacter = signal<Character | null>(null);

  private load(): Character[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as Character[]) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._characters()));
  }

  list(): Character[] {
    return this._characters();
  }

  get(id: string): Character | undefined {
    return this._characters().find(c => c.id === id);
  }

  create(partial: Partial<Character> & { name: string }): Character {
    const now = new Date().toISOString();
    const c: Character = {
      id: crypto.randomUUID(),
      photoHistory: [],
      personalityTags: [],
      ...partial,
      createdAt: now,
      updatedAt: now,
    };
    this._characters.update(cs => [...cs, c]);
    this.persist();
    return c;
  }

  update(id: string, patch: Partial<Character>): void {
    const now = new Date().toISOString();
    this._characters.update(cs =>
      cs.map(c => c.id === id ? { ...c, ...patch, updatedAt: now } : c)
    );
    this.persist();
  }

  delete(id: string): void {
    this._characters.update(cs => cs.filter(c => c.id !== id));
    if (this.activeCharacter()?.id === id) {
      this.activeCharacter.set(null);
    }
    this.persist();
  }

  setIdentityFilename(id: string, filename: string): void {
    this.update(id, { identityFilename: filename });
  }

  /** Insert-or-update by id. Used by the character-builder dialog so
   *  identity-portrait re-rolls hit a stable id without creating duplicate
   *  rows in the localStorage list. Differs from `create()` (which always
   *  generates a fresh uuid) and `update()` (which silently no-ops on miss). */
  upsertDraft(c: Character): Character {
    const existing = this.get(c.id);
    const now = new Date().toISOString();
    if (existing) {
      const merged: Character = { ...existing, ...c, updatedAt: now };
      this._characters.update(cs => cs.map(x => x.id === c.id ? merged : x));
      this.persist();
      return merged;
    }
    const created: Character = {
      photoHistory: [],
      personalityTags: [],
      ...c,
      createdAt: now,
      updatedAt: now,
    };
    this._characters.update(cs => [...cs, created]);
    this.persist();
    return created;
  }

  appendPhoto(id: string, filename: string): void {
    const c = this.get(id);
    if (!c) return;
    const next = [...(c.photoHistory ?? []), filename];
    this.update(id, { photoHistory: next });
  }

  /** Computed factory: true when the given character has a pinned identity
   *  portrait. Generate-route uses this to gate `buildCharacterWorkflow()`
   *  per CLAUDE.md hard rule #5 (character-id-lock). */
  hasIdentity(id: string): Signal<boolean> {
    return computed(() => {
      const c = this._characters().find(x => x.id === id);
      return !!c?.identityFilename;
    });
  }
}
