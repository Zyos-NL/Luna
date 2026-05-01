import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Character } from '../../core/character.service';

/**
 * Character builder dialog — placeholder for Fase 2.
 *
 * TODO Fase 2 (frontend agent):
 *   - Wire to CharacterService.create() / update()
 *   - All candy.ai fields (ethnicity, age-band, hair, eyes, body-type,
 *     breast/butt size, personality tags, default outfit)
 *   - Identity-portretpreview + regen button (calls
 *     workflow.service.buildCharacterCreation())
 *   - takeUntilDestroyed(this.destroyRef) on long-lived subscriptions
 */
@Component({
  selector: 'app-character-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ initialData ? 'Edit character' : 'New character' }}</h2>
    <mat-dialog-content>
      <p class="placeholder-note">
        Character builder coming in Fase 2 — candy.ai fields (ethnicity, age,
        hair, eyes, body-type, etc.) plus identity-portretpreview.
      </p>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Name</mat-label>
        <input matInput [ngModel]="name()" (ngModelChange)="name.set($event)" />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-flat-button color="primary" disabled>Save (Fase 2)</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .placeholder-note {
      color: #888;
      font-size: 0.85rem;
      margin: 0 0 16px;
    }
    .full-width { width: 100%; }
  `],
})
export class CharacterDialogComponent {
  protected dialogRef = inject(MatDialogRef<CharacterDialogComponent>);
  protected initialData = inject<Character | null>(MAT_DIALOG_DATA);

  protected name = signal(this.initialData?.name ?? '');
}
