import { Injectable } from '@angular/core';
import { CHARACTER_CREATION_TEMPLATE } from './workflows/character-creation.template';
import { TXT2IMG_CHARACTER_TEMPLATE } from './workflows/txt2img-character.template';
import { SCENE_VARIATION_TEMPLATE } from './workflows/scene-variation.template';
import type {
  BuildCharacterParams,
  BuiltWorkflow,
  CharacterCreationParams,
  CharacterEditParams,
  ComfyNode,
  SceneVariationParams,
  WireRef,
} from './workflow-types';

export type {
  BuildCharacterParams,
  BuiltWorkflow,
  CharacterCreationParams,
  CharacterEditParams,
  ComfyNode,
  SceneVariationParams,
} from './workflow-types';

/**
 * Server-side enforced negative-prompt baseline — must match CLAUDE.md
 * hard rule #9 EXACTLY. User additions are appended; baseline cannot be
 * removed by the frontend.
 */
const NEGATIVE_BASELINE =
  'anime, cartoon, illustration, painting, 3d render, cgi, plastic skin, ' +
  'deformed, mutated, extra fingers, fused fingers, bad anatomy, bad hands, ' +
  'malformed, asymmetric eyes, cross-eyed, blurry, low quality, jpeg artifacts, ' +
  'watermark, text, signature';

const DEFAULT_DIM = 1024;

/**
 * Builds ComfyUI prompt-graphs from validated TS templates.
 *
 * Hard rule alignment:
 * - #5 character-id-lock: `buildCharacterWorkflow` / `buildSceneVariation`
 *   require an `identityFilenameInComfyInput` and inject it into the
 *   ApplyPulidFlux chain via the LoadImage node.
 * - #6 FaceDetailer: included in every template; not user-disableable.
 * - #7 Output >=1024: defaults enforced here.
 * - #9 negative-prompt baseline: `composeNegative()` always prepends.
 * - #14 Skin-LoRA always-on: baked into the templates, not removed here.
 *
 * Templates are imported as TS modules (Option A) — typed, deep-cloned
 * before mutation, no runtime fetch needed.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private readonly NEGATIVE_BASELINE = NEGATIVE_BASELINE;

  // -------- Builders -------------------------------------------------------

  async buildCharacterCreation(params: CharacterCreationParams): Promise<BuiltWorkflow> {
    const wf = this.cloneTemplate(CHARACTER_CREATION_TEMPLATE);
    const seed = params.seed ?? this.randomSeed();

    this.setPositive(wf, params.positivePrompt);
    this.setNegative(wf, this.composeNegative(params.negativeExtra));
    this.setLatentDimensions(wf, params.width ?? DEFAULT_DIM, params.height ?? DEFAULT_DIM);
    this.setAllSeeds(wf, seed);
    this.setSavePrefix(wf, `characters/${params.characterId}/identity`);

    return wf;
  }

  async buildCharacterWorkflow(params: BuildCharacterParams): Promise<BuiltWorkflow> {
    const wf = this.cloneTemplate(TXT2IMG_CHARACTER_TEMPLATE);
    const seed = params.seed ?? this.randomSeed();

    this.setPositive(wf, params.positivePrompt);
    this.setNegative(wf, this.composeNegative(params.negativeExtra));
    this.setLatentDimensions(wf, params.width ?? DEFAULT_DIM, params.height ?? DEFAULT_DIM);
    this.setAllSeeds(wf, seed);
    this.setIdentityImage(wf, params.identityFilenameInComfyInput);
    this.setSavePrefix(wf, `characters/${params.characterId}/scene`);

    return wf;
  }

  async buildSceneVariation(params: SceneVariationParams): Promise<BuiltWorkflow> {
    // Same shape as buildCharacterWorkflow; the SCENE_VARIATION template
    // has PuLID weight=0.6 / end_at=0.5 baked in (vs. 0.8/0.7 for daily
    // driver), so we don't touch the ApplyPulidFlux node here.
    const wf = this.cloneTemplate(SCENE_VARIATION_TEMPLATE);
    const seed = params.seed ?? this.randomSeed();

    this.setPositive(wf, params.positivePrompt);
    this.setNegative(wf, this.composeNegative(params.negativeExtra));
    this.setLatentDimensions(wf, params.width ?? DEFAULT_DIM, params.height ?? DEFAULT_DIM);
    this.setAllSeeds(wf, seed);
    this.setIdentityImage(wf, params.identityFilenameInComfyInput);
    this.setSavePrefix(wf, `characters/${params.characterId}/variation`);

    return wf;
  }

  async buildCharacterEdit(_params: CharacterEditParams): Promise<BuiltWorkflow> {
    throw new Error(
      'buildCharacterEdit: Fase 3 — Flux Kontext + TensorRT nog niet geïmplementeerd'
    );
  }

  // -------- Server-side enforced negative ---------------------------------

  /** Server-side enforced negative-prompt. User mag toevoegen, niet
   *  weghalen (CLAUDE.md hard rule #9). */
  composeNegative(userExtra?: string): string {
    const extra = userExtra?.trim();
    return extra ? `${this.NEGATIVE_BASELINE}, ${extra}` : this.NEGATIVE_BASELINE;
  }

  randomSeed(): number {
    // KSampler accepts uint32; Math.floor(...*2**32) hits the full range.
    return Math.floor(Math.random() * 2 ** 32);
  }

  // -------- Mutation helpers ----------------------------------------------

  private setPositive(wf: BuiltWorkflow, text: string): void {
    const id = this.findPositiveTextNodeId(wf);
    wf[id].inputs['text'] = text;
  }

  private setNegative(wf: BuiltWorkflow, text: string): void {
    const id = this.findNegativeTextNodeId(wf);
    wf[id].inputs['text'] = text;
  }

  private setLatentDimensions(wf: BuiltWorkflow, width: number, height: number): void {
    // EmptySD3LatentImage is the Flux/SD3 latent variant. Templates use
    // exactly one — guarded by findNodeIdByClass.
    const id = this.findNodeIdByClass(wf, 'EmptySD3LatentImage');
    wf[id].inputs['width'] = width;
    wf[id].inputs['height'] = height;
  }

  /** KSampler.seed AND FaceDetailer.seed must match for deterministic
   *  re-rolls; FaceDetailer reuses the same seed so feature placement is
   *  stable. */
  private setAllSeeds(wf: BuiltWorkflow, seed: number): void {
    const ksamplerId = this.findNodeIdByClass(wf, 'KSampler');
    wf[ksamplerId].inputs['seed'] = seed;

    // FaceDetailer is optional in the mini stacks but always present in
    // our character templates. Search-don't-throw via the *Maybe variant.
    const faceDetailerId = this.findNodeIdByClassMaybe(wf, 'FaceDetailer');
    if (faceDetailerId !== null) {
      wf[faceDetailerId].inputs['seed'] = seed;
    }
  }

  private setIdentityImage(wf: BuiltWorkflow, imagePath: string): void {
    // PuLID-bearing workflows have exactly one LoadImage feeding
    // ApplyPulidFlux. Path is relative to ComfyUI's input/-dir, e.g.
    // "characters/<id>/identity.png".
    const id = this.findNodeIdByClass(wf, 'LoadImage');
    wf[id].inputs['image'] = imagePath;
  }

  private setSavePrefix(wf: BuiltWorkflow, prefix: string): void {
    const id = this.findNodeIdByClass(wf, 'SaveImage');
    wf[id].inputs['filename_prefix'] = prefix;
  }

  // -------- Node lookup helpers -------------------------------------------

  /** Find the unique node-id with the given class_type. Throws if 0 or
   *  >1 matches — guards against template drift (same class twice means
   *  the trail-finder below is no longer safe). */
  private findNodeIdByClass(wf: BuiltWorkflow, classType: string): string {
    const matches = Object.entries(wf).filter(([, node]) => node.class_type === classType);
    if (matches.length === 0) {
      throw new Error(`WorkflowService: no node with class_type "${classType}"`);
    }
    if (matches.length > 1) {
      throw new Error(
        `WorkflowService: expected exactly 1 "${classType}" node, found ${matches.length}`
      );
    }
    return matches[0][0];
  }

  /** Like findNodeIdByClass but returns null when no match (still throws
   *  on duplicates — duplicates always indicate a template bug). */
  private findNodeIdByClassMaybe(wf: BuiltWorkflow, classType: string): string | null {
    const matches = Object.entries(wf).filter(([, node]) => node.class_type === classType);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new Error(
        `WorkflowService: expected at most 1 "${classType}" node, found ${matches.length}`
      );
    }
    return matches[0][0];
  }

  /** Trace KSampler.positive -> FluxGuidance(positive) -> CLIPTextEncode.
   *  Returning the CLIPTextEncode node-id so we can mutate `text` without
   *  hardcoding "node 6". */
  private findPositiveTextNodeId(wf: BuiltWorkflow): string {
    const ksamplerId = this.findNodeIdByClass(wf, 'KSampler');
    const positiveWire = this.expectWire(wf[ksamplerId].inputs['positive'], `KSampler.positive`);
    return this.expectClipTextEncodeBehindFluxGuidance(wf, positiveWire[0]);
  }

  /** Trace KSampler.negative -> FluxGuidance(negative) -> CLIPTextEncode. */
  private findNegativeTextNodeId(wf: BuiltWorkflow): string {
    const ksamplerId = this.findNodeIdByClass(wf, 'KSampler');
    const negativeWire = this.expectWire(wf[ksamplerId].inputs['negative'], `KSampler.negative`);
    return this.expectClipTextEncodeBehindFluxGuidance(wf, negativeWire[0]);
  }

  private expectClipTextEncodeBehindFluxGuidance(
    wf: BuiltWorkflow,
    fluxGuidanceId: string,
  ): string {
    const guidanceNode = wf[fluxGuidanceId];
    if (!guidanceNode || guidanceNode.class_type !== 'FluxGuidance') {
      throw new Error(
        `WorkflowService: expected FluxGuidance at "${fluxGuidanceId}", got "${guidanceNode?.class_type ?? 'undefined'}"`,
      );
    }
    const condWire = this.expectWire(
      guidanceNode.inputs['conditioning'],
      `FluxGuidance.conditioning`,
    );
    const clipNode = wf[condWire[0]];
    if (!clipNode || clipNode.class_type !== 'CLIPTextEncode') {
      throw new Error(
        `WorkflowService: expected CLIPTextEncode at "${condWire[0]}", got "${clipNode?.class_type ?? 'undefined'}"`,
      );
    }
    return condWire[0];
  }

  private expectWire(value: unknown, label: string): WireRef {
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'number'
    ) {
      return [value[0], value[1]] as const;
    }
    throw new Error(`WorkflowService: ${label} is not a [nodeId, outputIndex] wire-ref`);
  }

  // -------- Cloning --------------------------------------------------------

  /** Deep-clone the read-only template before mutating. structuredClone
   *  is available in all modern browsers and Node 17+. Cast back to
   *  BuiltWorkflow because the cloned object is structurally identical. */
  private cloneTemplate(template: BuiltWorkflow): BuiltWorkflow {
    const cloned = structuredClone(template) as Record<string, ComfyNode>;
    return cloned;
  }
}
