import { Injectable, signal } from '@angular/core';
import { GeneratedImage } from './comfy.service';

export interface SessionImage extends GeneratedImage {
  /** Optional: tagged when generated through `buildCharacterWorkflow()` so the
   *  gallery can filter by character. Workflow.service is responsible for
   *  setting this — see character-id-lock rule (CLAUDE.md hard rule #5). */
  characterId?: string;
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly images = signal<SessionImage[]>([]);

  addImage(image: SessionImage): void {
    this.images.update(imgs => [image, ...imgs]);
  }

  removeImage(id: string): void {
    this.images.update(imgs => imgs.filter(img => img.id !== id));
  }

  clearSession(): void {
    this.images.set([]);
  }
}
