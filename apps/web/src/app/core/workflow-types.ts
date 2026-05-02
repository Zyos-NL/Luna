/**
 * Shared types for ComfyUI workflow graphs.
 *
 * A ComfyUI prompt is a flat JSON object keyed by node-id (string) where
 * each value is a ComfyNode. The HTTP `/prompt` endpoint accepts this as
 * `{prompt: <BuiltWorkflow>, client_id}`.
 *
 * We export a typed shape so the TS workflow templates (see
 * `./workflows/*.template.ts`) can be authored as `as const` literals
 * while still being assignable to `Record<string, ComfyNode>` after a
 * deep-clone in WorkflowService.
 */

/** A single ComfyUI graph node. `inputs` are heterogeneous: scalars,
 *  strings, booleans, or wire-references to other nodes encoded as
 *  `[nodeId, outputIndex]` tuples. */
export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

/** A complete ComfyUI prompt-graph, ready for `comfy.queuePrompt()`. */
export type BuiltWorkflow = Record<string, ComfyNode>;

/** Result of a builder call: the workflow plus the resolved seed.
 *  When `params.seed` is omitted the builder generates a random uint32;
 *  callers persist `seed` on the SessionImage so re-rolls are reproducible. */
export interface BuildResult {
  wf: BuiltWorkflow;
  seed: number;
}

/** Wire reference: `[sourceNodeId, outputIndex]`. */
export type WireRef = readonly [string, number];

// ---- Builder param shapes ---------------------------------------------------

export interface CharacterCreationParams {
  characterId: string;
  /** User-typed scene/look description (Flux uses natural language). */
  positivePrompt: string;
  /** Optional user-extra negative — appended AFTER NEGATIVE_BASELINE.
   *  Server-side baseline is enforced (CLAUDE.md hard rule #9). */
  negativeExtra?: string;
  /** uint32; randomised when omitted. */
  seed?: number;
  /** Default 1024 (CLAUDE.md hard rule #7). */
  width?: number;
  /** Default 1024 (CLAUDE.md hard rule #7). */
  height?: number;
}

export interface BuildCharacterParams {
  characterId: string;
  /** Path RELATIVE to ComfyUI's input/-dir, e.g.
   *  `"characters/<id>/identity.png"`. Upload via
   *  `ComfyService.uploadImage()` first to obtain it. */
  identityFilenameInComfyInput: string;
  positivePrompt: string;
  negativeExtra?: string;
  seed?: number;
  width?: number;
  height?: number;
}

/** Same shape as BuildCharacterParams; the difference is purely the
 *  template (lower PuLID weight 0.6 / end_at 0.5). */
export type SceneVariationParams = BuildCharacterParams;

export interface CharacterEditParams {
  characterId: string;
  /** Path relative to ComfyUI input/, of the previously-generated image
   *  to edit. */
  sourceImageFilename: string;
  editPrompt: string;
}
