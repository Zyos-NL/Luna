import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, firstValueFrom, forkJoin, map } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ComfyProgress {
  promptId: string;
  value: number;
  max: number;
}

export interface ComfyImageOutput {
  filename: string;
  subfolder: string;
  type: string;
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  negativePrompt: string;
  seed: number;
  timestamp: number;
}

/** Shape of a single entry in ComfyUI's `/history/<promptId>` response.
 *  ComfyUI keys the top-level response by promptId; this is the inner value. */
export interface HistoryEntry {
  prompt: unknown;
  outputs: Record<string, { images?: ComfyImageOutput[] }>;
  status: {
    status_str: 'success' | 'error' | string;
    completed: boolean;
    messages?: unknown[];
  };
}

@Injectable({ providedIn: 'root' })
export class ComfyService {
  private http = inject(HttpClient);
  private ws: WebSocket | null = null;
  private clientId = crypto.randomUUID();

  readonly progress$ = new Subject<ComfyProgress>();
  readonly imageReady$ = new Subject<{ promptId: string; images: ComfyImageOutput[] }>();

  private _connected = signal(false);
  readonly connected = this._connected.asReadonly();

  connect(): void {
    const state = this.ws?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    this.ws = new WebSocket(`${environment.comfyUrl.replace('http', 'ws')}/ws?clientId=${this.clientId}`);

    this.ws.onopen = () => this._connected.set(true);
    this.ws.onclose = () => {
      this._connected.set(false);
      // Reconnect after 3 seconds (ComfyUI may have restarted)
      setTimeout(() => this.connect(), 3000);
    };

    this.ws.onmessage = (event) => {
      // ComfyUI sends binary frames for image previews — skip them
      if (typeof event.data !== 'string') return;

      let msg: { type: string; data: Record<string, unknown> };
      try {
        msg = JSON.parse(event.data) as typeof msg;
      } catch {
        return;
      }

      if (msg.type === 'progress') {
        const d = msg.data as { prompt_id: string; value: number; max: number };
        this.progress$.next({
          promptId: d.prompt_id,
          value: d.value,
          max: d.max,
        });
      }

      if (msg.type === 'executed') {
        const d = msg.data as { prompt_id: string; output?: { images?: ComfyImageOutput[] } };
        if (d.output?.images) {
          this.imageReady$.next({
            promptId: d.prompt_id,
            images: d.output.images,
          });
        }
      }
    };
  }

  queuePrompt(workflow: Record<string, unknown>): Observable<{ prompt_id: string }> {
    return this.http.post<{ prompt_id: string }>(`${environment.comfyUrl}/prompt`, {
      prompt: workflow,
      client_id: this.clientId,
    });
  }

  /**
   * Upload an image to ComfyUI's `input/` directory so workflow nodes
   * (e.g. PuLID-Flux's LoadImage) can reference it by relative path.
   *
   * Returns a promise so workflow-builders can `await` it inline.
   * Response shape comes straight from ComfyUI's `/upload/image` route:
   *   { name: stored-filename, subfolder, type: "input" }
   *
   * Caller composes the workflow input as
   *   `${subfolder ? subfolder + "/" : ""}${name}`
   * which is the exact path PuLID's LoadImage expects.
   *
   * @param file       File or Blob (Blob → caller must ensure mime is set
   *                   sensibly; ComfyUI uses extension from the upload
   *                   filename so we pass `image.png` as a default).
   * @param subfolder  Optional subdirectory under `input/`, e.g.
   *                   `"characters/<id>"`.
   * @param overwrite  Replace any existing file with the same name; we
   *                   default to `true` because identity.png re-rolls
   *                   should clobber the previous attempt.
   */
  async uploadImage(
    file: File | Blob,
    subfolder?: string,
    overwrite = true,
  ): Promise<{ name: string; subfolder: string; type: string }> {
    const form = new FormData();
    // ComfyUI uses the third FormData arg as the filename. Files already
    // carry one; for raw Blobs we synthesize a sane default.
    if (file instanceof File) {
      form.append('image', file);
    } else {
      form.append('image', file, 'image.png');
    }
    if (subfolder) form.append('subfolder', subfolder);
    form.append('overwrite', overwrite ? 'true' : 'false');
    form.append('type', 'input');

    return firstValueFrom(
      this.http.post<{ name: string; subfolder: string; type: string }>(
        `${environment.comfyUrl}/upload/image`,
        form,
      ),
    );
  }

  getImageUrl(filename: string, subfolder: string, type: string): string {
    return `${environment.comfyUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
  }

  getHistory(promptId: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${environment.comfyUrl}/history/${promptId}`);
  }

  /**
   * Polls `/history/<promptId>` until the prompt completes (or errors out).
   *
   * Why polling? ComfyUI's WebSocket `executed` event fires per-output-node,
   * which is fine for live progress but doesn't include the final
   * `status_str`. The history endpoint is the canonical source-of-truth for
   * "did this prompt actually succeed and what files did it write?"
   *
   * @param promptId    Returned from `queuePrompt(...)`.
   * @param timeoutMs   Default 5 min — Flux Q5_K_S on RTX 4070 is ~52s for
   *                    1024px, FaceDetailer adds ~30-60s, so a 5-min ceiling
   *                    leaves headroom for queue waits without hanging
   *                    indefinitely.
   * @param intervalMs  Default 1s — friendly to ComfyUI's HTTP server.
   */
  async waitForResult(
    promptId: string,
    timeoutMs = 5 * 60 * 1000,
    intervalMs = 1000,
  ): Promise<HistoryEntry> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const raw = await firstValueFrom(this.getHistory(promptId));
      const entry = raw[promptId] as HistoryEntry | undefined;
      if (entry?.status) {
        // ComfyUI marks errored prompts as status_str='error' BEFORE
        // setting completed=true. Bail early so the UI doesn't hang for
        // 5 minutes waiting on a failed prompt.
        if (entry.status.status_str === 'error') {
          const errMsg = this.extractExecutionError(entry) ?? 'unknown error';
          throw new Error(`ComfyUI prompt ${promptId} failed: ${errMsg}`);
        }
        if (entry.status.completed) {
          return entry;
        }
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`ComfyUI prompt ${promptId} timed out after ${timeoutMs}ms`);
  }

  private extractExecutionError(entry: HistoryEntry): string | null {
    const messages = entry.status?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (Array.isArray(msg) && msg[0] === 'execution_error') {
        const err = msg[1] as { node_type?: string; exception_message?: string };
        const nodeType = err?.node_type ?? 'unknown node';
        const exMsg = (err?.exception_message ?? '').split('\n')[0];
        return `${nodeType}: ${exMsg}`;
      }
    }
    return null;
  }

  getCheckpoints(): Observable<string[]> {
    return this.http.get<Record<string, { input: { required: Record<string, unknown[][]> } }>>(
      `${environment.comfyUrl}/object_info/CheckpointLoaderSimple`
    ).pipe(
      map(info => {
        const required = info['CheckpointLoaderSimple']?.input?.required;
        const ckptList = required?.['ckpt_name']?.[0];
        return Array.isArray(ckptList) ? ckptList as string[] : [];
      })
    );
  }

  getLoras(): Observable<string[]> {
    return this.http.get<Record<string, { input: { required: Record<string, unknown[][]> } }>>(
      `${environment.comfyUrl}/object_info/LoraLoader`
    ).pipe(
      map(info => {
        const required = info['LoraLoader']?.input?.required;
        const loraList = required?.['lora_name']?.[0];
        return Array.isArray(loraList) ? loraList as string[] : [];
      })
    );
  }

  checkConnection(): Observable<unknown> {
    return this.http.get(`${environment.comfyUrl}/system_stats`);
  }

  /** Cancels the running prompt and drops everything pending. Used by the
   * UI's emergency-stop button when a generation hangs or takes too long. */
  clearQueue(): Observable<unknown> {
    return forkJoin({
      cleared: this.http.post(`${environment.comfyUrl}/queue`, { clear: true }),
      interrupted: this.http.post(`${environment.comfyUrl}/interrupt`, {}),
    });
  }
}
