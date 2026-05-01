import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ComfyService } from './core/comfy.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatToolbarModule, MatButtonModule, MatIconModule, MatTooltipModule,
  ],
  template: `
    <mat-toolbar class="app-toolbar">
      <a routerLink="/characters" class="logo">Luna</a>
      <span class="spacer"></span>
      <a mat-button routerLink="/characters" routerLinkActive="nav-active">
        <mat-icon>people</mat-icon> Characters
      </a>
      <a mat-button routerLink="/generate" routerLinkActive="nav-active">
        <mat-icon>auto_awesome</mat-icon> Generate
      </a>
      <a mat-button routerLink="/edit" routerLinkActive="nav-active">
        <mat-icon>edit</mat-icon> Edit
      </a>
      <a mat-button routerLink="/gallery" routerLinkActive="nav-active">
        <mat-icon>photo_library</mat-icon> Gallery
      </a>
      <span class="status-chip" [class.online]="comfy.connected()"
        [matTooltip]="comfy.connected() ? 'ComfyUI ready (port 18190) — Flux.1 dev backend' : 'ComfyUI offline (:18190) — start Docker Desktop and run docker compose up -d'">
        <mat-icon>{{ comfy.connected() ? 'cloud_done' : 'cloud_off' }}</mat-icon>
        ComfyUI
      </span>
    </mat-toolbar>
    <main class="app-main">
      <router-outlet />
    </main>
  `,
  styles: [`
    .app-toolbar {
      background: #1a1a1a;
      border-bottom: 1px solid #333;
      height: 48px;
      min-height: 48px;
      gap: 4px;
    }
    .logo {
      font-size: 1.2rem;
      font-weight: 700;
      color: #007acc;
      letter-spacing: 0.05em;
      text-decoration: none;
      margin-right: 8px;
    }
    .spacer { flex: 1; }
    .app-main {
      height: calc(100vh - 48px);
      overflow: hidden;
    }
    :host ::ng-deep .nav-active {
      color: #007acc !important;
    }
    .status-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 8px;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 0.72rem;
      font-weight: 500;
      letter-spacing: 0.02em;
      background: #3a1f1f;
      color: #e88;
      border: 1px solid #5a2929;
      transition: background 0.2s, color 0.2s, border-color 0.2s;

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }

      &.online {
        background: #1e3a23;
        color: #8ddc94;
        border-color: #2a5c33;
      }
    }
  `],
})
export class App {
  protected comfy = inject(ComfyService);

  constructor() {
    this.comfy.connect();
  }
}
