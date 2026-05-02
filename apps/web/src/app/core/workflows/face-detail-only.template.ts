import type { BuiltWorkflow } from '../workflow-types';

/**
 * Mirror of `infra/workflows/face-detail-only.json` (13 nodes).
 * Standalone repair-pass: skip txt2img stage, just LoadImage ->
 * FaceDetailer -> SaveImage with the Flux mini-stack (UNet + DualCLIP +
 * VAE + Skin LoRA only — no Jib Mix, no PuLID).
 *
 * Used when an existing image needs a face-quality re-pass without
 * re-rolling the composition. WorkflowService doesn't expose a builder
 * for this yet (Fase 2 stretch / Fase 3); keeping the template in TS now
 * so it lives next to its siblings.
 *
 * Maintained by the character-pipeline agent. Read-only.
 */
export const FACE_DETAIL_ONLY_TEMPLATE: BuiltWorkflow = {
  '1': {
    class_type: 'UnetLoaderGGUF',
    inputs: { unet_name: 'flux1-dev-Q5_K_S.gguf' },
    _meta: { title: 'Load Flux UNet (GGUF) — minimal mini-stack for FaceDetailer' },
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
  '4': {
    class_type: 'LoraLoaderModelOnly',
    inputs: {
      model: ['1', 0],
      lora_name: 'photorealisticSkinNoPlastic_flux.safetensors',
      strength_model: 0.5,
    },
    _meta: {
      title: 'LoRA: Photorealistic Skin No Plastic (always-on for skin quality during repair)',
    },
  },
  '5': {
    class_type: 'LoadImage',
    inputs: { image: 'example.png' },
    _meta: { title: 'Load Image to Repair (set via UI / API override)' },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'photorealistic face, sharp eyes, natural skin texture, detailed lips',
      clip: ['2', 0],
    },
    _meta: { title: 'Positive prompt (face-detail context)' },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '', clip: ['2', 0] },
    _meta: { title: 'Negative baseline (server-side enforced)' },
  },
  '8': {
    class_type: 'FluxGuidance',
    inputs: { conditioning: ['6', 0], guidance: 3.5 },
    _meta: { title: 'Flux Guidance (positive, 3.5)' },
  },
  '9': {
    class_type: 'FluxGuidance',
    inputs: { conditioning: ['7', 0], guidance: 3.5 },
    _meta: { title: 'Flux Guidance (negative, 3.5)' },
  },
  '13': {
    class_type: 'UltralyticsDetectorProvider',
    inputs: { model_name: 'bbox/face_yolov8m.pt' },
    _meta: { title: 'BBox Detector: face_yolov8m' },
  },
  '14': {
    class_type: 'SAMLoader',
    inputs: { model_name: 'sam_vit_b_01ec64.pth', device_mode: 'AUTO' },
    _meta: { title: 'SAM Loader (vit_b)' },
  },
  '15': {
    class_type: 'FaceDetailer',
    inputs: {
      image: ['5', 0],
      model: ['4', 0],
      clip: ['2', 0],
      vae: ['3', 0],
      positive: ['8', 0],
      negative: ['9', 0],
      bbox_detector: ['13', 0],
      sam_model_opt: ['14', 0],
      guide_size: 512,
      guide_size_for: true,
      max_size: 1024,
      seed: 42,
      steps: 20,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 0.35,
      feather: 8,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: 0.5,
      bbox_dilation: 10,
      bbox_crop_factor: 3.0,
      sam_detection_hint: 'center-1',
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: 'False',
      drop_size: 10,
      wildcard: '',
      cycle: 1,
      inpaint_model: false,
      noise_mask_feather: 20,
    },
    _meta: { title: 'FaceDetailer (standalone repair-pass, denoise=0.35, feather=8)' },
  },
  '16': {
    class_type: 'SaveImage',
    inputs: {
      images: ['15', 0],
      filename_prefix: 'characters/test/face_repair',
    },
    _meta: { title: 'Save Image -> outputs/characters/<id>/face_repair_*' },
  },
};
