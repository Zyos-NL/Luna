import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CharacterService } from '../../core/character.service';

@Component({
  selector: 'app-generate',
  standalone: true,
  imports: [
    FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatTooltipModule, MatSnackBarModule,
  ],
  template: `
    <div class="generate-wrapper">
      <h2 class="page-title">Generate</h2>

      @if (chars.list().length === 0) {
        <div class="empty-state">
          <mat-icon class="empty-icon">person_off</mat-icon>
          <p>No characters yet</p>
          <p class="empty-sub">
            Create a character with an identity portrait first — character-id-lock
            requires a pinned identity (CLAUDE.md hard rule #5).
          </p>
        </div>
      } @else {
        <div class="form-grid">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Character</mat-label>
            <mat-select [(ngModel)]="selectedId">
              @for (c of chars.list(); track c.id) {
                <mat-option [value]="c.id" [disabled]="!c.identityFilename">
                  {{ c.name }}
                  @if (!c.identityFilename) { (no identity) }
                </mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Scene</mat-label>
            <input matInput [(ngModel)]="scene"
              placeholder="kitchen morning, soft window light" [disabled]="!hasIdentity()" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Outfit</mat-label>
            <input matInput [(ngModel)]="outfit"
              placeholder="white t-shirt and jeans" [disabled]="!hasIdentity()" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Pose</mat-label>
            <input matInput [(ngModel)]="poseText"
              placeholder="leaning against the counter, looking at camera"
              [disabled]="!hasIdentity()" />
          </mat-form-field>

          <div class="row-2">
            <mat-form-field appearance="outline">
              <mat-label>Shot</mat-label>
              <mat-select [(ngModel)]="shot" [disabled]="!hasIdentity()">
                <mat-option value="full-body">Full body</mat-option>
                <mat-option value="three-quarter">Three-quarter</mat-option>
                <mat-option value="medium">Medium</mat-option>
                <mat-option value="close-up">Close-up</mat-option>
                <mat-option value="portrait">Portrait</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Mood</mat-label>
              <input matInput [(ngModel)]="mood"
                placeholder="warm, candid" [disabled]="!hasIdentity()" />
            </mat-form-field>
          </div>

          <button mat-flat-button color="primary" class="generate-btn"
            [disabled]="!hasIdentity()" (click)="onGenerate()"
            [matTooltip]="hasIdentity() ? 'Queue Flux + PuLID-Flux generation' : 'Pick a character with an identity portrait first'">
            <mat-icon>auto_awesome</mat-icon> Generate
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; }
    .generate-wrapper { max-width: 720px; margin: 0 auto; padding: 24px; }
    .page-title { font-size: 1.5rem; font-weight: 600; color: #d4d4d4; margin: 0 0 24px; }
    .form-grid { display: flex; flex-direction: column; gap: 8px; }
    .full-width { width: 100%; }
    .row-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .generate-btn {
      align-self: flex-start;
      margin-top: 8px;
      min-width: 160px;
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
  `],
})
export class GenerateComponent {
  protected chars = inject(CharacterService);
  private snackBar = inject(MatSnackBar);

  protected selectedId = signal<string | null>(null);
  protected scene = signal('');
  protected outfit = signal('');
  protected poseText = signal('');
  protected shot = signal<string>('three-quarter');
  protected mood = signal('');

  /** Character-id-lock: form is disabled until a character with a pinned
   *  identity portrait is selected (CLAUDE.md hard rule #5). */
  protected readonly hasIdentity = computed(() => {
    const id = this.selectedId();
    if (!id) return false;
    const c = this.chars.list().find(x => x.id === id);
    return !!c?.identityFilename;
  });

  onGenerate(): void {
    // TODO Fase 2 (frontend agent): call workflow.service.buildCharacterWorkflow(),
    // queue via comfy.service.queuePrompt(), subscribe to imageReady$, push to
    // session.service with characterId tag.
    this.snackBar.open('Generate — coming in Fase 2', undefined, { duration: 2500 });
  }
}
