import { Injectable, inject } from '@angular/core';
import { ComfyService } from './comfy.service';
import { SessionService } from './session.service';
import { CharacterService, Character } from './character.service';

/** Server-side enforced negative-prompt baseline — must match CLAUDE.md
 *  hard rule #9 EXACTLY. User additions are appended; baseline cannot be
 *  removed by the frontend. */
const NEGATIVE_BASELINE =
  'anime, cartoon, illustration, painting, 3d render, cgi, plastic skin, ' +
  'deformed, mutated, extra fingers, fused fingers, bad anatomy, bad hands, ' +
  'malformed, asymmetric eyes, cross-eyed, blurry, low quality, jpeg artifacts, ' +
  'watermark, text, signature';

export interface CharacterCreationParams {
  character: Character;
  prompt: string;
  seed?: number;
}

export interface CharacterWorkflowParams {
  character: Character;
  scene: string;
  outfit: string;
  poseText: string;
  shot: string;
  mood: string;
  userNegative?: string;
  seed?: number;
}

export interface SceneVariationParams extends CharacterWorkflowParams {
  /** Lower than default txt2img-character so scene gets more weight. */
  pulidWeight?: number;
}

export interface CharacterEditParams {
  character: Character;
  sourceFilename: string;
  editPrompt: string;
  seed?: number;
}

export interface BuiltWorkflow {
  workflow: Record<string, unknown>;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
}

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private comfy = inject(ComfyService);
  private session = inject(SessionService);
  private characters = inject(CharacterService);

  private readonly NEGATIVE_BASELINE = NEGATIVE_BASELINE;

  /** TODO Fase 2 (character-pipeline): bouw character-creation.json — Flux
   *  Q5 + Jib Mix(0.7) + Skin LoRA(0.5) → KSampler(20, cfg 3.5, euler/simple)
   *  → VAEDecode → FaceDetailer → SaveImage filename_prefix
   *  `characters/<id>/identity`. Return BuiltWorkflow. */
  async buildCharacterCreation(_params: CharacterCreationParams): Promise<BuiltWorkflow> {
    throw new Error('buildCharacterCreation: not implemented (Fase 2)');
  }

  /** TODO Fase 2 (character-pipeline): bouw txt2img-character.json — als
   *  character-creation + PuLID-Flux (weight 0.8, end 0.7, ref=identity.png).
   *  Skin-LoRA always-on (rule #14). FaceDetailer verplicht (rule #6). */
  async buildCharacterWorkflow(_params: CharacterWorkflowParams): Promise<BuiltWorkflow> {
    throw new Error('buildCharacterWorkflow: not implemented (Fase 2)');
  }

  /** TODO Fase 2 (character-pipeline): bouw scene-variation.json —
   *  txt2img-character met PuLID weight 0.6, end 0.5 zodat scene meer ruimte
   *  krijgt voor compositie/pose. */
  async buildSceneVariation(_params: SceneVariationParams): Promise<BuiltWorkflow> {
    throw new Error('buildSceneVariation: not implemented (Fase 2)');
  }

  /** TODO Fase 3 (character-pipeline): bouw character-edit.json — Flux
   *  Kontext FP8 + TensorRT engine + identity.png + edit-prompt. Vereist
   *  `infra/scripts/build-tensorrt.mjs` eerst. */
  async buildCharacterEdit(_params: CharacterEditParams): Promise<BuiltWorkflow> {
    throw new Error('buildCharacterEdit: not implemented (Fase 3)');
  }

  /** Server-side enforced negative-prompt. User mag toevoegen, niet
   *  weghalen (CLAUDE.md hard rule #9). */
  composeNegative(userExtra?: string): string {
    const extra = userExtra?.trim();
    return extra ? `${this.NEGATIVE_BASELINE}, ${extra}` : this.NEGATIVE_BASELINE;
  }

  randomSeed(): number {
    return Math.floor(Math.random() * 2 ** 32);
  }
}
