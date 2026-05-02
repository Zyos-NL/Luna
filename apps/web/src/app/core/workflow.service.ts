import { Injectable } from '@angular/core';
import { CHARACTER_CREATION_TEMPLATE } from './workflows/character-creation.template';
import { TXT2IMG_CHARACTER_TEMPLATE } from './workflows/txt2img-character.template';
import { SCENE_VARIATION_TEMPLATE } from './workflows/scene-variation.template';
import { CHARACTER_EDIT_TEMPLATE } from './workflows/character-edit.template';
import type {
  BuildCharacterEditParams,
  BuildCharacterParams,
  BuildResult,
  BuiltWorkflow,
  CharacterCreationParams,
  CharacterEditParams,
  ComfyNode,
  SceneVariationParams,
  WireRef,
} from './workflow-types';

export type {
  BuildCharacterEditParams,
  BuildCharacterParams,
  BuildResult,
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

  async buildCharacterCreation(params: CharacterCreationParams): Promise<BuildResult> {
    const wf = this.cloneTemplate(CHARACTER_CREATION_TEMPLATE);
    const seed = params.seed ?? this.randomSeed();

    this.setPositive(wf, params.positivePrompt);
    this.setNegative(wf, this.composeNegative(params.negativeExtra));
    this.setLatentDimensions(wf, params.width ?? DEFAULT_DIM, params.height ?? DEFAULT_DIM);
    this.setAllSeeds(wf, seed);
    this.setSavePrefix(wf, `characters/${params.characterId}/identity`);

    return { wf, seed };
  }

  async buildCharacterWorkflow(params: BuildCharacterParams): Promise<BuildResult> {
    const wf = this.cloneTemplate(TXT2IMG_CHARACTER_TEMPLATE);
    const seed = params.seed ?? this.randomSeed();

    this.setPositive(wf, params.positivePrompt);
    this.setNegative(wf, this.composeNegative(params.negativeExtra));
    this.setLatentDimensions(wf, params.width ?? DEFAULT_DIM, params.height ?? DEFAULT_DIM);
    this.setAllSeeds(wf, seed);
    this.setIdentityImage(wf, params.identityFilenameInComfyInput);
    this.setSavePrefix(wf, `characters/${params.characterId}/scene`);

    return { wf, seed };
  }

  async buildSceneVariation(params: SceneVariationParams): Promise<BuildResult> {
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

    return { wf, seed };
  }

  async buildCharacterEdit(params: BuildCharacterEditParams): Promise<BuildResult> {
    // Flux Kontext edit: source-image goes through LoadImage ->
    // FluxKontextImageScale -> VAEEncode -> ReferenceLatent. Kontext
    // determines its own dimensions via FluxKontextImageScale, so we
    // skip setLatentDimensions here.
    const wf = this.cloneTemplate(CHARACTER_EDIT_TEMPLATE);
    const seed = params.seed ?? this.randomSeed();

    this.setPositive(wf, params.editPrompt);
    this.setNegative(wf, this.composeNegative(params.negativeExtra));
    this.setAllSeeds(wf, seed);
    // Source image for Kontext is loaded via the same unique LoadImage
    // node pattern as the identity image in PuLID workflows; reuse the
    // setter for consistency.
    this.setSourceImage(wf, params.sourceImageInComfyInput);
    this.setSavePrefix(wf, `characters/${params.characterId}/edit`);

    return { wf, seed };
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

  /** Kontext edit workflows have exactly one LoadImage feeding the
   *  FluxKontextImageScale -> VAEEncode -> ReferenceLatent chain. Same
   *  unique-LoadImage finder as setIdentityImage, separate name purely
   *  for readability at the call-site. */
  private setSourceImage(wf: BuiltWorkflow, imagePath: string): void {
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

  /** Trace KSampler.positive -> [ReferenceLatent ->] FluxGuidance ->
   *  CLIPTextEncode. The optional ReferenceLatent hop is present in
   *  Flux Kontext edit workflows where the positive conditioning is
   *  enriched with the source-image latent before reaching KSampler.
   *  Returning the CLIPTextEncode node-id so we can mutate `text`
   *  without hardcoding "node 6". */
  private findPositiveTextNodeId(wf: BuiltWorkflow): string {
    const ksamplerId = this.findNodeIdByClass(wf, 'KSampler');
    const positiveWire = this.expectWire(wf[ksamplerId].inputs['positive'], `KSampler.positive`);
    let cursor = positiveWire[0];
    const cursorNode = wf[cursor];
    if (cursorNode?.class_type === 'ReferenceLatent') {
      const condWire = this.expectWire(
        cursorNode.inputs['conditioning'],
        `ReferenceLatent.conditioning`,
      );
      cursor = condWire[0];
    }
    return this.expectClipTextEncodeBehindFluxGuidance(wf, cursor);
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
