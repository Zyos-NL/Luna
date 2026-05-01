import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, forkJoin, map } from 'rxjs';
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

  uploadImage(file: File): Observable<{ name: string; subfolder: string; type: string }> {
    const form = new FormData();
    form.append('image', file);
    return this.http.post<{ name: string; subfolder: string; type: string }>(
      `${environment.comfyUrl}/upload/image`,
      form
    );
  }

  getImageUrl(filename: string, subfolder: string, type: string): string {
    return `${environment.comfyUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
  }

  getHistory(promptId: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${environment.comfyUrl}/history/${promptId}`);
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
