import { Component, inject, computed, signal, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SessionService, SessionImage } from '../../core/session.service';
import { CharacterService } from '../../core/character.service';

@Component({
  selector: 'app-gallery',
  standalone: true,
  imports: [
    FormsModule, MatIconModule, MatButtonModule, MatTooltipModule,
    MatFormFieldModule, MatSelectModule, MatSnackBarModule,
  ],
  template: `
    <div class="gallery-wrapper">
      <div class="gallery-header">
        <h2 class="page-title">Gallery</h2>

        <mat-form-field appearance="outline" class="filter-field">
          <mat-label>Character filter</mat-label>
          <mat-select [(ngModel)]="characterFilter">
            <mat-option [value]="null">All characters</mat-option>
            @for (c of chars.list(); track c.id) {
              <mat-option [value]="c.id">{{ c.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        @if (filtered().length > 0) {
          <button mat-stroked-button (click)="clearAll()">
            <mat-icon>delete_sweep</mat-icon> Clear session
          </button>
        }
      </div>

      @if (filtered().length === 0) {
        <div class="empty-state">
          <mat-icon class="empty-icon">photo_library</mat-icon>
          <p>No images yet</p>
          <p class="empty-sub">
            Generated images appear here for the current session.
          </p>
        </div>
      } @else {
        <div class="gallery-grid">
          @for (image of filtered(); track image.id) {
            <div class="gallery-card">
              <img [src]="image.url" [alt]="image.prompt" class="gallery-img"
                (click)="openLightbox(image)" />
              <div class="gallery-actions">
                <button mat-icon-button (click)="download(image)" matTooltip="Download">
                  <mat-icon>download</mat-icon>
                </button>
                <button mat-icon-button (click)="remove(image)" matTooltip="Remove">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </div>
          }
        </div>
      }

      @if (lightboxImage(); as img) {
        <div class="lightbox-overlay" (click)="closeLightbox()">
          <div class="lightbox-content" (click)="$event.stopPropagation()">
            <img [src]="img.url" [alt]="img.prompt" class="lightbox-img" />
            <div class="lightbox-footer">
              <span class="lightbox-prompt" [matTooltip]="img.prompt">{{ img.prompt }}</span>
              <div class="lightbox-actions">
                <button mat-icon-button (click)="download(img)" matTooltip="Download">
                  <mat-icon>download</mat-icon>
                </button>
                <button mat-icon-button (click)="remove(img)" matTooltip="Remove">
                  <mat-icon>delete</mat-icon>
                </button>
                <button mat-icon-button (click)="closeLightbox()" matTooltip="Close (Esc)">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; }
    .gallery-wrapper { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .gallery-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    .page-title {
      font-size: 1.5rem;
      font-weight: 600;
      color: #d4d4d4;
      margin: 0;
      flex: 1;
    }
    .filter-field {
      width: 220px;
    }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
    }
    .gallery-card {
      position: relative;
      border-radius: 8px;
      overflow: hidden;
      background: #2a2a2a;
      border: 1px solid #333;
      transition: border-color 0.15s;
      &:hover {
        border-color: #555;
        .gallery-actions { opacity: 1; }
      }
    }
    .gallery-img {
      width: 100%;
      aspect-ratio: 9 / 16;
      object-fit: cover;
      display: block;
      cursor: pointer;
    }
    .gallery-actions {
      position: absolute;
      top: 0;
      right: 0;
      display: flex;
      flex-direction: column;
      opacity: 0;
      transition: opacity 0.15s;
      background: #0009;
      border-radius: 0 8px 0 8px;
      button {
        width: 32px; height: 32px; line-height: 32px;
        mat-icon { font-size: 16px; width: 16px; height: 16px; }
      }
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      gap: 12px;
      color: #555;
      text-align: center;
    }
    .empty-icon { font-size: 72px; width: 72px; height: 72px; color: #333; }
    .empty-state p { margin: 0; font-size: 1rem; color: #888; }
    .empty-sub { font-size: 0.85rem !important; color: #555 !important; max-width: 380px; }

    .lightbox-overlay {
      position: fixed;
      inset: 0;
      background: #000c;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fade-in 0.15s ease;
    }
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
    .lightbox-content {
      display: flex;
      flex-direction: column;
      max-width: min(90vw, 900px);
      max-height: 90vh;
      border-radius: 10px;
      overflow: hidden;
      background: #1e1e1e;
      border: 1px solid #444;
      box-shadow: 0 24px 80px #0008;
    }
    .lightbox-img {
      max-width: 100%;
      max-height: calc(90vh - 60px);
      object-fit: contain;
      display: block;
    }
    .lightbox-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      background: #252525;
      border-top: 1px solid #333;
      min-height: 52px;
    }
    .lightbox-prompt {
      flex: 1;
      font-size: 0.78rem;
      color: #888;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lightbox-actions { display: flex; gap: 2px; flex-shrink: 0; }
  `],
})
export class GalleryComponent {
  private session = inject(SessionService);
  protected chars = inject(CharacterService);
  private snackBar = inject(MatSnackBar);

  protected characterFilter = signal<string | null>(null);
  readonly lightboxImage = signal<SessionImage | null>(null);

  readonly filtered = computed(() => {
    const filter = this.characterFilter();
    const all = this.session.images();
    return filter ? all.filter(img => img.characterId === filter) : all;
  });

  @HostListener('document:keydown.escape')
  closeLightbox(): void {
    this.lightboxImage.set(null);
  }

  openLightbox(image: SessionImage): void {
    this.lightboxImage.set(image);
  }

  download(image: SessionImage): void {
    const a = document.createElement('a');
    a.href = image.url;
    a.download = `luna_${image.seed}.png`;
    a.click();
  }

  remove(image: SessionImage): void {
    this.session.removeImage(image.id);
    if (this.lightboxImage()?.id === image.id) this.lightboxImage.set(null);
  }

  clearAll(): void {
    this.session.clearSession();
    this.lightboxImage.set(null);
    this.snackBar.open('Session cleared', undefined, { duration: 2000 });
  }
}
