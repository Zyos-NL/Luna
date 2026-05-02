import { Component, inject, signal, computed, DestroyRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CharacterService } from '../../core/character.service';
import { ComfyImageOutput, ComfyService, GeneratedImage } from '../../core/comfy.service';
import { WorkflowService } from '../../core/workflow.service';
import { SessionService } from '../../core/session.service';
import { composeScenePrompt } from '../../core/prompt-compose';
import { environment } from '../../../environments/environment';

type GenerateMode = 'standard' | 'scene-variation';
type ShotType = 'portrait' | 'half-body' | 'full-body';

interface SizePreset {
  label: string;
  width: number;
  height: number;
}

const SIZE_PRESETS: SizePreset[] = [
  { label: 'Square 1024×1024', width: 1024, height: 1024 },
  { label: 'Portrait 832×1216', width: 832, height: 1216 },
  { label: 'Tall 768×1344', width: 768, height: 1344 },
];

@Component({
  selector: 'app-generate',
  standalone: true,
  imports: [
    FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatRadioModule, MatSlideToggleModule,
    MatTooltipModule, MatProgressBarModule, MatSnackBarModule,
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
            <mat-select [ngModel]="selectedId()" (ngModelChange)="onCharacterPick($event)">
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
            <textarea matInput rows="2"
              [ngModel]="scene()" (ngModelChange)="scene.set($event)"
              placeholder="kitchen morning, soft window light"
              [disabled]="!hasIdentity()"></textarea>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Outfit</mat-label>
            <input matInput [ngModel]="outfit()" (ngModelChange)="outfit.set($event)"
              placeholder="white t-shirt and jeans" [disabled]="!hasIdentity()" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Pose</mat-label>
            <input matInput [ngModel]="poseText()" (ngModelChange)="poseText.set($event)"
              placeholder="leaning against the counter, looking at camera"
              [disabled]="!hasIdentity()" />
          </mat-form-field>

          <div class="row-2">
            <mat-form-field appearance="outline">
              <mat-label>Shot</mat-label>
              <mat-select [ngModel]="shot()" (ngModelChange)="shot.set($event)" [disabled]="!hasIdentity()">
                <mat-option value="portrait">Portrait</mat-option>
                <mat-option value="half-body">Half body</mat-option>
                <mat-option value="full-body">Full body</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Mood</mat-label>
              <input matInput [ngModel]="mood()" (ngModelChange)="mood.set($event)"
                placeholder="warm, candid" [disabled]="!hasIdentity()" />
            </mat-form-field>
          </div>

          <div class="row-2">
            <mat-form-field appearance="outline">
              <mat-label>Mode</mat-label>
              <mat-select [ngModel]="mode()" (ngModelChange)="mode.set($event)" [disabled]="!hasIdentity()">
                <mat-option value="standard">Standard (PuLID 0.8)</mat-option>
                <mat-option value="scene-variation">Scene variation (PuLID 0.6)</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Size</mat-label>
              <mat-select [ngModel]="sizePreset()" (ngModelChange)="sizePreset.set($event)"
                          [disabled]="!hasIdentity()">
                @for (p of sizePresets; track p.label) {
                  <mat-option [value]="p">{{ p.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>

          <div class="row-2">
            <mat-form-field appearance="outline">
              <mat-label>Seed (blank = random)</mat-label>
              <input matInput type="number" inputmode="numeric"
                [ngModel]="seedInput()" (ngModelChange)="seedInput.set($event)"
                placeholder="42" [disabled]="!hasIdentity()" />
            </mat-form-field>

            <div class="toggle-cell">
              <mat-slide-toggle [ngModel]="nsfw()" (ngModelChange)="nsfw.set($event)"
                                [disabled]="!hasIdentity()">
                NSFW
              </mat-slide-toggle>
            </div>
          </div>

          <div class="actions-row">
            <button mat-flat-button color="primary" class="generate-btn"
              [disabled]="!hasIdentity() || generating()" (click)="onGenerate()"
              [matTooltip]="hasIdentity() ? 'Queue Flux + PuLID-Flux generation' : 'Pick a character with an identity portrait first'">
              <mat-icon>auto_awesome</mat-icon>
              {{ generating() ? 'Generating…' : 'Generate' }}
            </button>
            @if (generating()) {
              <button mat-stroked-button (click)="cancel()">
                <mat-icon>stop</mat-icon> Cancel
              </button>
            }
          </div>

          @if (generating()) {
            <mat-progress-bar [mode]="progressPercent() > 0 ? 'determinate' : 'indeterminate'"
              [value]="progressPercent()"></mat-progress-bar>
            <p class="status-text">{{ statusText() }}</p>
          }

          @if (errorMsg(); as err) {
            <div class="error-row">
              <mat-icon>error</mat-icon>
              <span>{{ err }}</span>
            </div>
          }

          @if (resultUrl(); as url) {
            <div class="result-pane">
              <img [src]="url" alt="Generated image" />
              <p class="result-meta">Saved to gallery — view all in /gallery</p>
            </div>
          }
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
    .toggle-cell {
      display: flex;
      align-items: center;
      padding: 4px 0;
    }
    .actions-row {
      display: flex;
      gap: 12px;
      margin-top: 8px;
    }
    .generate-btn { min-width: 160px; }
    .status-text { font-size: 0.8rem; color: #888; margin: 4px 0 0; }
    .error-row {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      color: #cc4444;
      font-size: 0.85rem;
      mat-icon { flex-shrink: 0; }
    }
    .result-pane {
      margin-top: 16px;
      padding: 12px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      img { max-width: 100%; border-radius: 6px; }
    }
    .result-meta { font-size: 0.8rem; color: #888; margin: 0; }
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
  private comfy = inject(ComfyService);
  private workflow = inject(WorkflowService);
  private session = inject(SessionService);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  protected readonly sizePresets = SIZE_PRESETS;

  protected selectedId = signal<string | null>(null);
  protected scene = signal('');
  protected outfit = signal('');
  protected poseText = signal('');
  protected shot = signal<ShotType>('half-body');
  protected mood = signal('');
  protected mode = signal<GenerateMode>('standard');
  protected sizePreset = signal<SizePreset>(SIZE_PRESETS[0]);
  protected seedInput = signal<number | null>(null);
  protected nsfw = signal(false);

  protected generating = signal(false);
  protected progressPercent = signal(0);
  protected statusText = signal('');
  protected errorMsg = signal<string | null>(null);
  protected resultUrl = signal<string | null>(null);

  /** Tracks the prompt currently in flight so WS progress events can be
   *  filtered to just our generation (other tabs / other apps may be
   *  hitting the same ComfyUI backend). */
  private currentPromptId: string | null = null;

  constructor() {
    // Make sure the WS is open so we receive `progress` frames during
    // generation. ComfyService.connect() is idempotent.
    this.comfy.connect();

    this.comfy.progress$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(p => {
        if (p.promptId === this.currentPromptId && p.max > 0) {
          this.progressPercent.set(Math.round((p.value / p.max) * 100));
          this.statusText.set(`Sampling step ${p.value}/${p.max}…`);
        }
      });
  }

  /** Character-id-lock: form is disabled until a character with a pinned
   *  identity portrait is selected (CLAUDE.md hard rule #5). */
  protected readonly hasIdentity = computed(() => {
    const id = this.selectedId();
    if (!id) return false;
    const c = this.chars.list().find(x => x.id === id);
    return !!c?.identityFilename;
  });

  onCharacterPick(id: string | null): void {
    this.selectedId.set(id);
    if (!id) return;
    const c = this.chars.list().find(x => x.id === id);
    // Pre-fill the outfit input from the character's default outfit so the
    // common "same character, varied scene" path doesn't require re-typing.
    if (c?.defaultOutfit && !this.outfit().trim()) {
      this.outfit.set(c.defaultOutfit);
    }
  }

  cancel(): void {
    this.comfy.clearQueue()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.generating.set(false);
          this.statusText.set('Cancelled');
          this.snackBar.open('Queue cleared', undefined, { duration: 2000 });
        },
        error: (err: { message?: string }) => {
          this.snackBar.open(`Cancel failed: ${err.message ?? err}`, 'OK', { duration: 4000 });
        },
      });
  }

  async onGenerate(): Promise<void> {
    const charId = this.selectedId();
    if (!charId) return;
    const character = this.chars.list().find(c => c.id === charId);
    if (!character?.identityFilename) {
      this.snackBar.open('Selected character has no identity portrait', undefined, { duration: 3000 });
      return;
    }

    this.generating.set(true);
    this.errorMsg.set(null);
    this.resultUrl.set(null);
    this.progressPercent.set(0);
    this.statusText.set('Uploading identity to ComfyUI input/…');

    try {
      // STEP 1 — re-upload identity portrait into ComfyUI's input/-dir.
      // ComfyUI saved it under output/characters/<id>/, but PuLID's
      // LoadImage node only resolves paths under input/. We round-trip
      // the file via /view -> /upload/image so subsequent generations
      // can reference it as `characters/<id>/<filename>`.
      const identityBlob = await this.fetchOutputAsBlob(
        character.identityFilename,
        `characters/${character.id}`,
      );
      const upload = await this.comfy.uploadImage(
        identityBlob,
        `characters/${character.id}`,
        true,
      );
      const identityPathInInput = upload.subfolder
        ? `${upload.subfolder}/${upload.name}`
        : upload.name;

      // STEP 2 — compose Flux natural-language prompt from character + form.
      const positivePrompt = composeScenePrompt(character, {
        scene: this.scene(),
        outfit: this.outfit(),
        poseText: this.poseText(),
        shot: this.shot(),
        mood: this.mood(),
      });

      // STEP 3 — build workflow via WorkflowService. Standard vs.
      // scene-variation flips the template; identity-filename + dims +
      // seed all flow through the builder.
      const size = this.sizePreset();
      const seed = this.seedInput();
      const buildParams = {
        characterId: character.id,
        identityFilenameInComfyInput: identityPathInInput,
        positivePrompt,
        width: size.width,
        height: size.height,
        seed: seed ?? undefined,
      };

      this.statusText.set('Building workflow…');
      const wf = this.mode() === 'standard'
        ? await this.workflow.buildCharacterWorkflow(buildParams)
        : await this.workflow.buildSceneVariation(buildParams);

      // STEP 4 — queue + wait.
      this.statusText.set('Queueing prompt to ComfyUI…');
      const queueRes = await firstValueFrom(this.comfy.queuePrompt(wf));
      this.currentPromptId = queueRes.prompt_id;
      this.statusText.set('Sampling — Flux Q5 + PuLID + FaceDetailer (~60-90s)…');

      const result = await this.comfy.waitForResult(queueRes.prompt_id);
      const image = this.firstSaveImageOutput(result.outputs);
      if (!image) {
        throw new Error('ComfyUI completed but produced no SaveImage output');
      }

      // STEP 5 — display + persist to session.
      const url = this.comfy.getImageUrl(image.filename, image.subfolder, image.type);
      this.resultUrl.set(url);
      this.progressPercent.set(100);
      this.statusText.set('Done');

      const generated: GeneratedImage = {
        id: crypto.randomUUID(),
        url,
        prompt: positivePrompt,
        negativePrompt: this.workflow.composeNegative(),
        // Reseed-blank workflows: actual seed is randomized in WorkflowService;
        // we store what the user requested (or 0 sentinel for "random").
        seed: seed ?? 0,
        timestamp: Date.now(),
      };
      this.session.addImage({ ...generated, characterId: character.id });
      this.chars.appendPhoto(character.id, image.filename);
    } catch (e) {
      this.errorMsg.set(e instanceof Error ? e.message : String(e));
      this.statusText.set('Failed');
    } finally {
      this.currentPromptId = null;
      this.generating.set(false);
    }
  }

  // ---- Helpers ----------------------------------------------------------

  /** Fetches an image from ComfyUI's output/-dir as a Blob, ready for
   *  re-upload into input/. Used to bridge the identity-portrait between
   *  the saved-output and PuLID's LoadImage input-path. */
  private async fetchOutputAsBlob(filename: string, subfolder: string): Promise<Blob> {
    const url = `${environment.comfyUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=output`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch identity portrait (HTTP ${res.status}): ${url}`);
    }
    return await res.blob();
  }

  private firstSaveImageOutput(outputs: Record<string, { images?: ComfyImageOutput[] }>): ComfyImageOutput | null {
    for (const node of Object.values(outputs)) {
      if (node.images && node.images.length > 0) return node.images[0];
    }
    return null;
  }
}

