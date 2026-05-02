import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import {
  Character,
  CharacterService,
  AgeBand,
  BodyType,
  BreastSize,
  ButtSize,
} from '../../core/character.service';
import { ComfyService, ComfyImageOutput } from '../../core/comfy.service';
import { WorkflowService } from '../../core/workflow.service';
import { composeIdentityPrompt } from '../../core/prompt-compose';
import { environment } from '../../../environments/environment';

/**
 * Character builder dialog — candy.ai fields + identity-portrait preview.
 *
 * Flow:
 *   1. User fills form (name required, all other fields optional).
 *   2. Click "Create Identity" → composes a Flux natural-language prompt
 *      from the form, builds the character-creation workflow via
 *      WorkflowService, queues it through ComfyService, polls /history
 *      until the SaveImage node has written its output.
 *   3. Preview renders inline. User can re-roll (regenerates with new
 *      seed) or click Accept to persist the character + identity.
 *
 * Character-id-lock (CLAUDE.md hard rule #5): Accept is disabled until an
 * identity portrait exists. Once accepted, the character is generate-able
 * via PuLID-Flux on the /generate route.
 *
 * NB: ComfyUI writes to OUTPUT (luna/outputs/) not INPUT — so we only
 * store the filename here. The Generate flow uploads the saved file back
 * into ComfyUI's input/-dir at the moment of generation.
 */

const ETHNICITIES = [
  'Mediterranean', 'East Asian', 'Northern European', 'South Asian',
  'African', 'Latin', 'Middle Eastern', 'Mixed',
] as const;

const HAIR_COLORS = [
  'black', 'brown', 'dark blonde', 'blonde', 'red', 'grey',
] as const;

const HAIR_STYLES = [
  'long wavy', 'long straight', 'shoulder length', 'bob',
  'pixie', 'ponytail', 'bun', 'braid',
] as const;

const EYE_COLORS = [
  'brown', 'hazel', 'green', 'blue', 'grey', 'amber',
] as const;

const AGE_BANDS: AgeBand[] = ['young-adult', 'adult', 'mature'];
const BODY_TYPES: BodyType[] = ['slim', 'athletic', 'curvy', 'plus'];
const BREAST_SIZES: BreastSize[] = ['small', 'medium', 'large', 'huge'];
const BUTT_SIZES: ButtSize[] = ['small', 'medium', 'large'];

@Component({
  selector: 'app-character-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatChipsModule,
    MatProgressSpinnerModule, MatProgressBarModule, MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ initialData?.id ? 'Edit character' : 'New character' }}</h2>
    <mat-dialog-content class="dialog-content">
      <div class="form-grid">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Name *</mat-label>
          <input matInput required [ngModel]="name()" (ngModelChange)="name.set($event)" />
        </mat-form-field>

        <div class="row-2">
          <mat-form-field appearance="outline">
            <mat-label>Ethnicity</mat-label>
            <mat-select [ngModel]="ethnicity()" (ngModelChange)="ethnicity.set($event)">
              <mat-option [value]="null">— none —</mat-option>
              @for (e of ethnicities; track e) {
                <mat-option [value]="e">{{ e }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Age band</mat-label>
            <mat-select [ngModel]="ageBand()" (ngModelChange)="ageBand.set($event)">
              <mat-option [value]="null">— none —</mat-option>
              @for (a of ageBands; track a) {
                <mat-option [value]="a">{{ ageBandLabel(a) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <div class="row-2">
          <mat-form-field appearance="outline">
            <mat-label>Hair color</mat-label>
            <mat-select [ngModel]="hairColor()" (ngModelChange)="hairColor.set($event)">
              <mat-option [value]="null">— none —</mat-option>
              @for (c of hairColors; track c) {
                <mat-option [value]="c">{{ c }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Hair style</mat-label>
            <mat-select [ngModel]="hairStyle()" (ngModelChange)="hairStyle.set($event)">
              <mat-option [value]="null">— none —</mat-option>
              @for (s of hairStyles; track s) {
                <mat-option [value]="s">{{ s }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <div class="row-2">
          <mat-form-field appearance="outline">
            <mat-label>Eye color</mat-label>
            <mat-select [ngModel]="eyeColor()" (ngModelChange)="eyeColor.set($event)">
              <mat-option [value]="null">— none —</mat-option>
              @for (e of eyeColors; track e) {
                <mat-option [value]="e">{{ e }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Body type</mat-label>
            <mat-select [ngModel]="bodyType()" (ngModelChange)="bodyType.set($event)">
              <mat-option [value]="null">— none —</mat-option>
              @for (b of bodyTypes; track b) {
                <mat-option [value]="b">{{ b }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <div class="row-2">
          <mat-form-field appearance="outline">
            <mat-label>Breast size</mat-label>
            <mat-select [ngModel]="breastSize()" (ngModelChange)="breastSize.set($event)">
              <mat-option [value]="null">— none —</mat-option>
              @for (b of breastSizes; track b) {
                <mat-option [value]="b">{{ b }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Butt size</mat-label>
            <mat-select [ngModel]="buttSize()" (ngModelChange)="buttSize.set($event)">
              <mat-option [value]="null">— none —</mat-option>
              @for (b of buttSizes; track b) {
                <mat-option [value]="b">{{ b }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Personality tags</mat-label>
          <mat-chip-grid #chipGrid>
            @for (tag of personalityTags(); track tag) {
              <mat-chip-row (removed)="removeTag(tag)">
                {{ tag }}
                <button matChipRemove><mat-icon>cancel</mat-icon></button>
              </mat-chip-row>
            }
          </mat-chip-grid>
          <input
            placeholder="Add tag (Enter)"
            [matChipInputFor]="chipGrid"
            [matChipInputAddOnBlur]="true"
            (matChipInputTokenEnd)="addTag($event)" />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Default outfit</mat-label>
          <input matInput [ngModel]="defaultOutfit()" (ngModelChange)="defaultOutfit.set($event)"
                 placeholder="white t-shirt and jeans" />
        </mat-form-field>
      </div>

      <div class="identity-pane">
        <div class="identity-header">
          <h3>Identity portrait</h3>
          <button mat-flat-button color="primary"
            [disabled]="generating() || !name().trim()"
            (click)="createIdentity()">
            <mat-icon>auto_awesome</mat-icon>
            {{ identityPreview() ? 'Re-roll identity' : 'Create identity' }}
          </button>
        </div>

        @if (generating()) {
          <div class="identity-status">
            <mat-progress-bar mode="indeterminate"></mat-progress-bar>
            <p class="status-text">Generating identity portrait — Flux Q5 + FaceDetailer (~60s)…</p>
          </div>
        }

        @if (errorMsg(); as err) {
          <div class="identity-error">
            <mat-icon>error</mat-icon>
            <span>{{ err }}</span>
          </div>
        }

        @if (identityPreview(); as src) {
          <img [src]="src" alt="Identity portrait" class="identity-preview" />
        } @else if (!generating()) {
          <div class="identity-placeholder">
            <mat-icon>person</mat-icon>
            <p>Fill name + traits, click Create identity</p>
          </div>
        }
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-flat-button color="primary"
        [disabled]="!canAccept()" (click)="accept()">
        Save
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }
    .dialog-content {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 24px;
      max-height: 70vh;
      overflow: hidden;
    }
    .form-grid {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .full-width { width: 100%; }
    .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    .identity-pane {
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 12px;
    }
    .identity-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      h3 { margin: 0; font-size: 0.95rem; color: #d4d4d4; }
    }
    .identity-status {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .status-text {
      font-size: 0.8rem;
      color: #888;
      margin: 0;
    }
    .identity-error {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      color: #cc4444;
      font-size: 0.85rem;
      mat-icon { flex-shrink: 0; }
    }
    .identity-preview {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 6px;
      background: #000;
    }
    .identity-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      aspect-ratio: 1;
      color: #555;
      text-align: center;
      border: 1px dashed #333;
      border-radius: 6px;
      gap: 8px;
      mat-icon { font-size: 56px; width: 56px; height: 56px; }
      p { margin: 0; font-size: 0.8rem; }
    }
  `],
})
export class CharacterDialogComponent {
  protected dialogRef = inject(MatDialogRef<CharacterDialogComponent>);
  protected initialData = inject<Character | null>(MAT_DIALOG_DATA);
  private characters = inject(CharacterService);
  private comfy = inject(ComfyService);
  private workflow = inject(WorkflowService);
  private snackBar = inject(MatSnackBar);

  protected readonly ethnicities = ETHNICITIES;
  protected readonly ageBands = AGE_BANDS;
  protected readonly hairColors = HAIR_COLORS;
  protected readonly hairStyles = HAIR_STYLES;
  protected readonly eyeColors = EYE_COLORS;
  protected readonly bodyTypes = BODY_TYPES;
  protected readonly breastSizes = BREAST_SIZES;
  protected readonly buttSizes = BUTT_SIZES;

  // Stable id across re-rolls — generated once on first Create-Identity if
  // we're a brand-new character, otherwise inherited from initialData.
  private characterId: string = this.initialData?.id ?? this.shortId();

  protected name = signal(this.initialData?.name ?? '');
  protected ethnicity = signal<string | null>(this.initialData?.ethnicity ?? null);
  protected ageBand = signal<AgeBand | null>(this.initialData?.ageBand ?? null);
  protected hairColor = signal<string | null>(this.initialData?.hairColor ?? null);
  protected hairStyle = signal<string | null>(this.initialData?.hairStyle ?? null);
  protected eyeColor = signal<string | null>(this.initialData?.eyeColor ?? null);
  protected bodyType = signal<BodyType | null>(this.initialData?.bodyType ?? null);
  protected breastSize = signal<BreastSize | null>(this.initialData?.breastSize ?? null);
  protected buttSize = signal<ButtSize | null>(this.initialData?.buttSize ?? null);
  protected personalityTags = signal<string[]>(this.initialData?.personalityTags ?? []);
  protected defaultOutfit = signal(this.initialData?.defaultOutfit ?? '');

  protected generating = signal(false);
  /** filename + subfolder of the saved identity in ComfyUI's output/ dir. */
  private identityFilename = signal<string | null>(this.initialData?.identityFilename ?? null);
  private identitySubfolder = signal<string>(this.initialData ? `characters/${this.initialData.id}` : '');
  protected identityPreview = signal<string | null>(
    this.initialData?.identityFilename
      ? `${environment.comfyUrl}/view?filename=${encodeURIComponent(this.initialData.identityFilename)}&subfolder=${encodeURIComponent('characters/' + this.initialData.id)}&type=output`
      : null,
  );
  protected errorMsg = signal<string | null>(null);

  protected readonly canAccept = computed(() =>
    !this.generating() && !!this.name().trim() && !!this.identityFilename()
  );

  ageBandLabel(a: AgeBand): string {
    switch (a) {
      case 'young-adult': return 'Young adult (18-25)';
      case 'adult': return 'Adult (26-39)';
      case 'mature': return 'Mature (40+)';
    }
  }

  addTag(event: MatChipInputEvent): void {
    const value = (event.value ?? '').trim();
    if (value) {
      this.personalityTags.update(tags => [...tags, value]);
    }
    event.chipInput?.clear();
  }

  removeTag(tag: string): void {
    this.personalityTags.update(tags => tags.filter(t => t !== tag));
  }

  async createIdentity(): Promise<void> {
    if (!this.name().trim()) {
      this.snackBar.open('Enter a name first', undefined, { duration: 2000 });
      return;
    }
    this.generating.set(true);
    this.errorMsg.set(null);
    try {
      // Persist the WIP character so the id is stable across re-rolls and
      // the SaveImage filename_prefix (`characters/<id>/identity`) lands
      // in the right folder.
      this.persistDraft();

      const prompt = composeIdentityPrompt(this.snapshotCharacter());
      const wf = await this.workflow.buildCharacterCreation({
        characterId: this.characterId,
        positivePrompt: prompt,
      });

      const queueRes = await firstValueFrom(this.comfy.queuePrompt(wf));
      const promptId = queueRes.prompt_id;

      const result = await this.comfy.waitForResult(promptId);
      const image = this.firstSaveImageOutput(result.outputs);
      if (!image) {
        throw new Error('ComfyUI completed but produced no SaveImage output');
      }

      this.identityFilename.set(image.filename);
      this.identitySubfolder.set(image.subfolder);
      this.identityPreview.set(this.comfy.getImageUrl(image.filename, image.subfolder, image.type));
      // Persist the filename now too so a Cancel after generation still
      // leaves the character with its identity. accept() finalizes name etc.
      this.characters.setIdentityFilename(this.characterId, image.filename);
    } catch (e) {
      this.errorMsg.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.generating.set(false);
    }
  }

  accept(): void {
    if (!this.canAccept()) return;
    this.persistDraft();
    this.dialogRef.close(this.snapshotCharacter());
  }

  // ---- Helpers ----------------------------------------------------------

  /** Walks the /history outputs map and returns the first image found.
   *  Templates have exactly one SaveImage node per workflow, so there's
   *  no ordering ambiguity in practice — but we don't hardcode the node
   *  id since templates can be edited. */
  private firstSaveImageOutput(outputs: Record<string, { images?: ComfyImageOutput[] }>): ComfyImageOutput | null {
    for (const node of Object.values(outputs)) {
      if (node.images && node.images.length > 0) return node.images[0];
    }
    return null;
  }

  /** Composes a Partial<Character> from the current form signals. */
  private snapshotCharacter(): Character {
    const now = new Date().toISOString();
    return {
      id: this.characterId,
      name: this.name().trim(),
      ethnicity: this.ethnicity() ?? undefined,
      ageBand: this.ageBand() ?? undefined,
      hairColor: this.hairColor() ?? undefined,
      hairStyle: this.hairStyle() ?? undefined,
      eyeColor: this.eyeColor() ?? undefined,
      bodyType: this.bodyType() ?? undefined,
      breastSize: this.breastSize() ?? undefined,
      buttSize: this.buttSize() ?? undefined,
      personalityTags: this.personalityTags(),
      defaultOutfit: this.defaultOutfit().trim() || undefined,
      identityFilename: this.identityFilename() ?? undefined,
      photoHistory: this.initialData?.photoHistory ?? [],
      createdAt: this.initialData?.createdAt ?? now,
      updatedAt: now,
    };
  }

  private persistDraft(): void {
    this.characters.upsertDraft(this.snapshotCharacter());
  }

  /** Short, URL-safe character-id. We don't need 128 bits of entropy here
   *  because the character is local-only; 8 hex chars is enough to avoid
   *  collisions in any plausible localStorage. */
  private shortId(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  }
}
