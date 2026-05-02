import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CharacterService } from '../../core/character.service';
import { ComfyImageOutput, ComfyService, GeneratedImage } from '../../core/comfy.service';
import { WorkflowService } from '../../core/workflow.service';
import { SessionService, SessionImage } from '../../core/session.service';
import { environment } from '../../../environments/environment';

/** A session image we can edit — the URL is parsed into ComfyUI
 *  filename/subfolder/type so we can round-trip the file from output/
 *  back into input/ for the Kontext source. */
interface EditableSource {
  sessionId: string;
  url: string;
  filename: string;
  subfolder: string;
  type: string;
  prompt: string;
}

@Component({
  selector: 'app-edit',
  standalone: true,
  imports: [
    FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatSlideToggleModule, MatTooltipModule,
    MatProgressBarModule, MatSnackBarModule,
  ],
  template: `
    <div class="edit-wrapper">
      <h2 class="page-title">Edit</h2>

      @if (chars.list().length === 0) {
        <div class="empty-state">
          <mat-icon class="empty-icon">person_off</mat-icon>
          <p>No characters yet</p>
          <p class="empty-sub">
            Create a character with an identity portrait first — Flux Kontext
            edits operate on previously-generated images of a character.
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

          @if (hasIdentity()) {
            <div class="source-picker">
              <p class="picker-label">Source image</p>
              @if (sourceCandidates().length === 0) {
                <p class="picker-hint">
                  No generated images for this character yet. Generate one
                  on the /generate page first — Kontext edits an existing
                  output, not a from-scratch image.
                </p>
              } @else {
                <div class="thumb-grid">
                  @for (src of sourceCandidates(); track src.sessionId) {
                    <button type="button" class="thumb"
                      [class.thumb-active]="selectedSource()?.sessionId === src.sessionId"
                      (click)="selectedSource.set(src)"
                      [matTooltip]="src.prompt"
                      matTooltipPosition="above">
                      <img [src]="src.url" alt="source candidate" />
                    </button>
                  }
                </div>
              }
            </div>
          }

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Edit instruction</mat-label>
            <textarea matInput rows="2"
              [ngModel]="editPrompt()" (ngModelChange)="editPrompt.set($event)"
              placeholder="change outfit to red evening dress"
              [disabled]="!hasIdentity() || !selectedSource()"></textarea>
          </mat-form-field>

          <div class="row-2">
            <mat-form-field appearance="outline">
              <mat-label>Seed (blank = random)</mat-label>
              <input matInput type="number" inputmode="numeric"
                [ngModel]="seedInput()" (ngModelChange)="seedInput.set($event)"
                placeholder="42" [disabled]="!canEdit()" />
            </mat-form-field>

            <div class="toggle-cell">
              <mat-slide-toggle [ngModel]="nsfw()" (ngModelChange)="nsfw.set($event)"
                                [disabled]="!canEdit()"
                                matTooltip="Off: blokkeert nudity. On: ondeugend mag."
                                matTooltipPosition="above">
                NSFW
              </mat-slide-toggle>
            </div>
          </div>

          <div class="actions-row">
            <button mat-flat-button color="primary" class="edit-btn"
              [disabled]="!canEdit() || editing()" (click)="onEdit()"
              [matTooltip]="canEdit() ? 'Queue Flux Kontext edit' : 'Pick a character, source image, and prompt first'">
              <mat-icon>auto_fix_high</mat-icon>
              {{ editing() ? 'Editing…' : 'Edit' }}
            </button>
            @if (editing()) {
              <button mat-stroked-button (click)="cancel()">
                <mat-icon>stop</mat-icon> Cancel
              </button>
            }
          </div>

          @if (editing()) {
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
              <img [src]="url" alt="Edited image" />
              <p class="result-meta">Saved to gallery — view all in /gallery</p>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; }
    .edit-wrapper { max-width: 720px; margin: 0 auto; padding: 24px; }
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
    .edit-btn { min-width: 160px; }
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
    .source-picker {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 0;
    }
    .picker-label {
      font-size: 0.85rem;
      color: #aaa;
      margin: 0;
    }
    .picker-hint {
      font-size: 0.8rem;
      color: #666;
      margin: 0;
      padding: 8px 0;
    }
    .thumb-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
      gap: 6px;
      max-height: 240px;
      overflow-y: auto;
      padding: 4px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 6px;
    }
    .thumb {
      padding: 0;
      border: 2px solid transparent;
      border-radius: 4px;
      background: #0d0d0d;
      cursor: pointer;
      overflow: hidden;
      aspect-ratio: 1;
      transition: border-color 80ms ease;
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
    }
    .thumb:hover { border-color: #555; }
    .thumb-active { border-color: #007acc; }
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
export class EditComponent {
  protected chars = inject(CharacterService);
  private comfy = inject(ComfyService);
  private workflow = inject(WorkflowService);
  private session = inject(SessionService);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  protected selectedId = signal<string | null>(null);
  protected selectedSource = signal<EditableSource | null>(null);
  protected editPrompt = signal('');
  protected seedInput = signal<number | null>(null);
  protected nsfw = signal(false);

  protected editing = signal(false);
  protected progressPercent = signal(0);
  protected statusText = signal('');
  protected errorMsg = signal<string | null>(null);
  protected resultUrl = signal<string | null>(null);

  /** Tracks the prompt currently in flight so WS progress events can be
   *  filtered to just our edit (other tabs / other apps may be hitting
   *  the same ComfyUI backend). */
  private currentPromptId: string | null = null;

  constructor() {
    // Idempotent — opens the WS so we receive `progress` frames.
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

  /** Session images filtered to just the picked character — these are
   *  the only valid Kontext sources (Kontext edits an existing output of
   *  THIS character, not a fresh generation). */
  protected readonly sourceCandidates = computed<EditableSource[]>(() => {
    const id = this.selectedId();
    if (!id) return [];
    return this.session.images()
      .filter(img => img.characterId === id)
      .map(img => this.toEditableSource(img))
      .filter((src): src is EditableSource => src !== null);
  });

  protected readonly canEdit = computed(() =>
    this.hasIdentity() && this.selectedSource() !== null && this.editPrompt().trim().length > 0
  );

  onCharacterPick(id: string | null): void {
    this.selectedId.set(id);
    // Picking a new character invalidates the previously-selected source
    // (it likely belonged to a different character).
    this.selectedSource.set(null);
  }

  cancel(): void {
    this.comfy.clearQueue()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.editing.set(false);
          this.statusText.set('Cancelled');
          this.snackBar.open('Queue cleared', undefined, { duration: 2000 });
        },
        error: (err: { message?: string }) => {
          this.snackBar.open(`Cancel failed: ${err.message ?? err}`, 'OK', { duration: 4000 });
        },
      });
  }

  async onEdit(): Promise<void> {
    const charId = this.selectedId();
    const source = this.selectedSource();
    const prompt = this.editPrompt().trim();
    if (!charId || !source || !prompt) return;
    const character = this.chars.list().find(c => c.id === charId);
    if (!character?.identityFilename) {
      this.snackBar.open('Selected character has no identity portrait', undefined, { duration: 3000 });
      return;
    }

    this.editing.set(true);
    this.errorMsg.set(null);
    this.resultUrl.set(null);
    this.progressPercent.set(0);
    this.statusText.set('Uploading source image to ComfyUI input/…');

    try {
      // STEP 1 — re-upload source image into ComfyUI's input/-dir.
      // The image was saved under output/<subfolder>/<filename> by a
      // previous generation; LoadImage in the Kontext workflow only
      // resolves paths under input/. We round-trip via /view -> /upload.
      const sourceBlob = await this.fetchOutputAsBlob(
        source.filename,
        source.subfolder,
        source.type,
      );
      const upload = await this.comfy.uploadImage(
        sourceBlob,
        `characters/${character.id}`,
        true,
      );
      const sourcePathInInput = upload.subfolder
        ? `${upload.subfolder}/${upload.name}`
        : upload.name;

      // STEP 2 — build the Kontext workflow. No width/height — Kontext
      // determines dimensions from the source image via
      // FluxKontextImageScale. NSFW toggle off blocks nudity via
      // negative-extra (server-side baseline always prepended).
      const negativeExtra = this.nsfw() ? undefined : 'nude, undressed, naked, explicit';
      const seed = this.seedInput();

      this.statusText.set('Building workflow…');
      const built = await this.workflow.buildCharacterEdit({
        characterId: character.id,
        sourceImageInComfyInput: sourcePathInInput,
        editPrompt: prompt,
        negativeExtra,
        seed: seed ?? undefined,
      });
      const { wf, seed: resolvedSeed } = built;

      // STEP 3 — queue + wait.
      this.statusText.set('Queueing prompt to ComfyUI…');
      const queueRes = await firstValueFrom(this.comfy.queuePrompt(wf));
      this.currentPromptId = queueRes.prompt_id;
      this.statusText.set('Sampling — Flux Kontext Q5_K_S + Skin LoRA (~50-70s)…');

      const result = await this.comfy.waitForResult(queueRes.prompt_id);
      const image = this.firstSaveImageOutput(result.outputs);
      if (!image) {
        throw new Error('ComfyUI completed but produced no SaveImage output');
      }

      // STEP 4 — display + persist to session.
      const url = this.comfy.getImageUrl(image.filename, image.subfolder, image.type);
      this.resultUrl.set(url);
      this.progressPercent.set(100);
      this.statusText.set('Done');

      const generated: GeneratedImage = {
        id: crypto.randomUUID(),
        url,
        prompt,
        negativePrompt: this.workflow.composeNegative(negativeExtra),
        seed: resolvedSeed,
        timestamp: Date.now(),
      };
      this.session.addImage({ ...generated, characterId: character.id });
      this.chars.appendPhoto(character.id, image.filename);
    } catch (e) {
      this.errorMsg.set(e instanceof Error ? e.message : String(e));
      this.statusText.set('Failed');
    } finally {
      this.currentPromptId = null;
      this.editing.set(false);
    }
  }

  // ---- Helpers ----------------------------------------------------------

  /** Parses a SessionImage URL produced by `ComfyService.getImageUrl()`
   *  back into the {filename, subfolder, type} triple ComfyUI uses on
   *  its /view + /upload endpoints. Returns null when the URL doesn't
   *  match the expected shape (e.g. external image), so the picker
   *  silently skips non-Kontext-compatible sources. */
  private toEditableSource(img: SessionImage): EditableSource | null {
    try {
      const u = new URL(img.url);
      const filename = u.searchParams.get('filename');
      const subfolder = u.searchParams.get('subfolder') ?? '';
      const type = u.searchParams.get('type');
      if (!filename || !type) return null;
      return {
        sessionId: img.id,
        url: img.url,
        filename,
        subfolder,
        type,
        prompt: img.prompt,
      };
    } catch {
      return null;
    }
  }

  /** Fetches an image from ComfyUI's output/-dir as a Blob, ready for
   *  re-upload into input/. Used to bridge the Kontext source-image
   *  between the saved-output and the Kontext workflow's LoadImage. */
  private async fetchOutputAsBlob(
    filename: string,
    subfolder: string,
    type: string,
  ): Promise<Blob> {
    const url = `${environment.comfyUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch source image (HTTP ${res.status}): ${url}`);
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
