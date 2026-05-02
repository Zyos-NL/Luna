import type { BuiltWorkflow } from '../workflow-types';

/**
 * Mirror of `infra/workflows/character-edit.json` (15 nodes, no PuLID).
 * Flux Kontext editing: Flux Kontext GGUF Q5_K_S + Skin LoRA (0.4) +
 * LoadImage -> FluxKontextImageScale -> VAEEncode -> ReferenceLatent
 * (image-conditioning) -> KSampler -> VAEDecode -> SaveImage.
 *
 * Differs from txt2img-character.json:
 * - UnetLoaderGGUF loads `flux1-kontext-dev-Q5_K_S.gguf` (NOT flux1-dev).
 * - Source image chain (LoadImage + FluxKontextImageScale + VAEEncode +
 *   ReferenceLatent) replaces EmptySD3LatentImage.
 * - FluxGuidance at 2.5 (Kontext default), not 3.5.
 * - No Jib Mix LoRA (Kontext is intrinsically photoreal-finetuned).
 * - No PuLID-Flux (Kontext preserves face from input image natively).
 * - No FaceDetailer (post-pass via face-detail-only.json if needed).
 * - denoise=1.0 (image-conditioning via ReferenceLatent, not low denoise).
 *
 * Maintained by the character-pipeline agent. Read-only — WorkflowService
 * deep-clones before mutating.
 */
export const CHARACTER_EDIT_TEMPLATE: BuiltWorkflow = {
  '1': {
    class_type: 'UnetLoaderGGUF',
    inputs: { unet_name: 'flux1-kontext-dev-Q5_K_S.gguf' },
    _meta: { title: 'Load Flux Kontext UNet (GGUF Q5_K_S)' },
  },
  '2': {
    class_type: 'DualCLIPLoader',
    inputs: {
      clip_name1: 't5xxl_fp8_e4m3fn.safetensors',
      clip_name2: 'clip_l.safetensors',
      type: 'flux',
    },
    _meta: { title: 'Load Dual CLIP (T5 fp8 + clip_l)' },
  },
  '3': {
    class_type: 'VAELoader',
    inputs: { vae_name: 'ae.safetensors' },
    _meta: { title: 'Load Flux VAE' },
  },
  '5': {
    class_type: 'LoraLoaderModelOnly',
    inputs: {
      model: ['1', 0],
      lora_name: 'photorealisticSkinNoPlastic_flux.safetensors',
      strength_model: 0.4,
    },
    _meta: { title: 'LoRA: Photorealistic Skin No Plastic (always-on, weight 0.4 for Kontext)' },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '', clip: ['2', 0] },
    _meta: { title: 'Positive prompt (edit instruction)' },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '', clip: ['2', 0] },
    _meta: { title: 'Negative baseline (server-side enforced)' },
  },
  '8': {
    class_type: 'FluxGuidance',
    inputs: { conditioning: ['6', 0], guidance: 2.5 },
    _meta: { title: 'Flux Guidance (positive, 2.5 — Kontext default)' },
  },
  '9': {
    class_type: 'FluxGuidance',
    inputs: { conditioning: ['7', 0], guidance: 2.5 },
    _meta: { title: 'Flux Guidance (negative, 2.5 — Kontext default)' },
  },
  '23': {
    class_type: 'LoadImage',
    inputs: { image: 'characters/test/scene_kitchen_00001_.png' },
    _meta: { title: 'Load Source Image (path RELATIVE to ComfyUI input/)' },
  },
  '30': {
    class_type: 'FluxKontextImageScale',
    inputs: { image: ['23', 0] },
    _meta: { title: 'Flux Kontext Image Scale (auto-resize to Kontext-compat resolution)' },
  },
  '31': {
    class_type: 'VAEEncode',
    inputs: { pixels: ['30', 0], vae: ['3', 0] },
    _meta: { title: 'VAE Encode (source image -> latent)' },
  },
  '32': {
    class_type: 'ReferenceLatent',
    inputs: { conditioning: ['8', 0], latent: ['31', 0] },
    _meta: { title: 'Reference Latent (inject image-conditioning onto positive cond)' },
  },
  '11': {
    class_type: 'KSampler',
    inputs: {
      model: ['5', 0],
      seed: 1337,
      steps: 20,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      positive: ['32', 0],
      negative: ['9', 0],
      latent_image: ['31', 0],
      denoise: 1.0,
    },
    _meta: { title: 'KSampler (Kontext: cfg=1.0, FluxGuidance handles guidance, denoise=1.0)' },
  },
  '12': {
    class_type: 'VAEDecode',
    inputs: { samples: ['11', 0], vae: ['3', 0] },
    _meta: { title: 'VAE Decode' },
  },
  '16': {
    class_type: 'SaveImage',
    inputs: {
      images: ['12', 0],
      filename_prefix: 'characters/test/edit',
    },
    _meta: { title: 'Save Image -> outputs/characters/<id>/edit_*.png' },
  },
};
