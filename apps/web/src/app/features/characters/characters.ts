import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CharacterService, Character } from '../../core/character.service';
import { ComfyService } from '../../core/comfy.service';
import { CharacterDialogComponent } from './character.dialog';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-characters',
  standalone: true,
  imports: [
    MatButtonModule, MatIconModule, MatCardModule,
    MatTooltipModule, MatDialogModule, MatSnackBarModule,
  ],
  template: `
    <div class="characters-wrapper">
      <div class="characters-header">
        <h2 class="page-title">Characters</h2>
        <button mat-flat-button color="primary" (click)="openNewCharacter()">
          <mat-icon>add</mat-icon> New character
        </button>
      </div>

      @if (chars.list().length === 0) {
        <div class="empty-state">
          <mat-icon class="empty-icon">people</mat-icon>
          <p>No characters yet</p>
          <p class="empty-sub">
            Create a character, generate an identity portrait, then use it across
            hundreds of scenes with PuLID-Flux character-id-lock.
          </p>
          <button mat-flat-button color="primary" (click)="openNewCharacter()">
            <mat-icon>add</mat-icon> Create first character
          </button>
        </div>
      } @else {
        <div class="character-grid">
          @for (c of chars.list(); track c.id) {
            <mat-card class="character-card">
              <div class="card-avatar">
                @if (c.identityFilename) {
                  <img class="avatar-img"
                    [src]="identityUrl(c)"
                    [alt]="c.name + ' identity portrait'" />
                  <div class="identity-badge" matTooltip="Identity portrait pinned — PuLID-Flux ready">
                    <mat-icon>verified</mat-icon>
                  </div>
                } @else {
                  <div class="avatar-placeholder">
                    <mat-icon>person</mat-icon>
                  </div>
                }
              </div>

              <mat-card-content>
                <h3 class="char-name">{{ c.name }}</h3>
                <div class="meta-row">
                  @if (c.ageBand) {
                    <span class="badge">{{ c.ageBand }}</span>
                  }
                  @if (c.ethnicity) {
                    <span class="badge">{{ c.ethnicity }}</span>
                  }
                  @if (c.bodyType) {
                    <span class="badge">{{ c.bodyType }}</span>
                  }
                </div>
              </mat-card-content>

              <mat-card-actions>
                <button mat-flat-button color="primary" (click)="onEdit(c)"
                  matTooltip="Edit character (Coming in Fase 2)">
                  <mat-icon>edit</mat-icon> Edit
                </button>
                <button mat-icon-button (click)="onDelete(c)" matTooltip="Delete character"
                  class="delete-btn">
                  <mat-icon>delete</mat-icon>
                </button>
              </mat-card-actions>
            </mat-card>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; }
    .characters-wrapper { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .characters-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .page-title { font-size: 1.5rem; font-weight: 600; color: #d4d4d4; margin: 0; }
    .character-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 20px;
    }
    .character-card {
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 12px;
      overflow: hidden;
      transition: border-color 0.15s;
      &:hover { border-color: #555; }
    }
    .card-avatar {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      background: #2a2a2a;
      overflow: hidden;
    }
    .avatar-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #555;
      mat-icon { font-size: 64px; width: 64px; height: 64px; }
    }
    .avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .identity-badge {
      position: absolute;
      top: 8px;
      right: 8px;
      background: #007acc;
      color: #fff;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    mat-card-content { padding: 12px 16px 0; }
    .char-name {
      font-size: 1rem;
      font-weight: 600;
      color: #d4d4d4;
      margin: 0 0 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .badge {
      font-size: 0.7rem;
      font-weight: 500;
      color: #aac;
      background: rgba(120, 140, 200, 0.1);
      border: 1px solid rgba(120, 140, 200, 0.25);
      padding: 2px 8px;
      border-radius: 999px;
      text-transform: capitalize;
    }
    mat-card-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 8px 8px;
    }
    mat-card-actions button[mat-flat-button] { flex: 1; font-size: 0.8rem; }
    .delete-btn { color: #666; &:hover { color: #cc4444; } }
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
  `],
})
export class CharactersComponent {
  protected chars = inject(CharacterService);
  private dialog = inject(MatDialog);
  private comfy = inject(ComfyService);
  private snackBar = inject(MatSnackBar);

  openNewCharacter(): void {
    this.dialog.open<CharacterDialogComponent, Character | null, Character | undefined>(
      CharacterDialogComponent,
      {
        width: '880px',
        maxWidth: '95vw',
        maxHeight: '95vh',
        data: null,
        autoFocus: 'first-tabbable',
      },
    );
  }

  onEdit(c: Character): void {
    this.dialog.open<CharacterDialogComponent, Character, Character | undefined>(
      CharacterDialogComponent,
      {
        width: '880px',
        maxWidth: '95vw',
        maxHeight: '95vh',
        data: c,
        autoFocus: 'first-tabbable',
      },
    );
  }

  onDelete(c: Character): void {
    if (confirm(`Delete character "${c.name}"? This removes the local entry, the identity portrait file in outputs/ stays.`)) {
      this.chars.delete(c.id);
      this.snackBar.open(`Deleted ${c.name}`, undefined, { duration: 2000 });
    }
  }

  /** Builds the ComfyUI /view URL for a character's identity portrait.
   *  Mirrors the SaveImage filename_prefix (`characters/<id>/identity_*.png`)
   *  set by WorkflowService when we ran character-creation. */
  identityUrl(c: Character): string {
    if (!c.identityFilename) return '';
    return `${environment.comfyUrl}/view?filename=${encodeURIComponent(c.identityFilename)}&subfolder=${encodeURIComponent('characters/' + c.id)}&type=output`;
  }
}
