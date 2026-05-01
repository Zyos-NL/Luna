import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'characters' },
  {
    path: 'characters',
    loadComponent: () =>
      import('./features/characters/characters').then(m => m.CharactersComponent),
  },
  {
    path: 'generate',
    loadComponent: () =>
      import('./features/generate/generate').then(m => m.GenerateComponent),
  },
  {
    path: 'edit',
    loadComponent: () =>
      import('./features/edit/edit').then(m => m.EditComponent),
  },
  {
    path: 'gallery',
    loadComponent: () =>
      import('./features/gallery/gallery').then(m => m.GalleryComponent),
  },
  { path: '**', redirectTo: 'characters' },
];
