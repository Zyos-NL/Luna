import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-edit',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="edit-wrapper">
      <h2 class="page-title">Edit</h2>

      <div class="placeholder">
        <mat-icon class="placeholder-icon">auto_fix_high</mat-icon>
        <p class="placeholder-title">Flux Kontext editing — coming in Fase 3</p>
        <p class="placeholder-sub">
          Pick an existing character image and an edit prompt
          ("change outfit to red dress") — uses Flux.1 Kontext FP8 + TensorRT.
          Requires <code>infra/scripts/build-tensorrt.mjs</code> first.
        </p>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; }
    .edit-wrapper { max-width: 720px; margin: 0 auto; padding: 24px; }
    .page-title { font-size: 1.5rem; font-weight: 600; color: #d4d4d4; margin: 0 0 24px; }
    .placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      gap: 12px;
      color: #555;
      text-align: center;
    }
    .placeholder-icon { font-size: 72px; width: 72px; height: 72px; color: #333; }
    .placeholder-title { margin: 0; font-size: 1rem; color: #888; }
    .placeholder-sub { font-size: 0.85rem; color: #555; max-width: 460px; margin: 0; }
    code {
      background: #2a2a2a;
      color: #aac;
      padding: 1px 6px;
      border-radius: 4px;
      font-family: 'Consolas', 'Courier New', monospace;
    }
  `],
})
export class EditComponent {}
