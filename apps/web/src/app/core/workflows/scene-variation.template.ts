import type { BuiltWorkflow } from '../workflow-types';

/**
 * Mirror of `infra/workflows/scene-variation.json` (21 nodes).
 * Same shape as txt2img-character but PuLID weight is lowered (0.6) and
 * end_at is earlier (0.5) so the scene/composition gets more freedom and
 * the identity-lock is softer — used when keeping the same character in
 * a substantially different setting/pose.
 *
 * Maintained by the character-pipeline agent. Read-only.
 */
export const SCENE_VARIATION_TEMPLATE: BuiltWorkflow = {
  '1': {
    class_type: 'UnetLoaderGGUF',
    inputs: { unet_name: 'flux1-dev-Q5_K_S.gguf' },
    _meta: { title: 'Load Flux UNet (GGUF)' },
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
      lora_name: 'jibMixFlux_v12.safetensors',
      strength_model: 0.7,
    },
    _meta: { title: 'LoRA: Jib Mix Flux v12 (NSFW finetune)' },
  },
  '5': {
    class_type: 'LoraLoaderModelOnly',
    inputs: {
      model: ['4', 0],
      lora_name: 'photorealisticSkinNoPlastic_flux.safetensors',
      strength_model: 0.5,
    },
    _meta: { title: 'LoRA: Photorealistic Skin No Plastic (always-on)' },
  },
  '20': {
    class_type: 'PulidFluxModelLoader',
    inputs: { pulid_file: 'pulid_flux_v0.9.1.safetensors' },
    _meta: { title: 'PuLID-Flux Model Loader' },
  },
  '21': {
    class_type: 'PulidFluxInsightFaceLoader',
    inputs: { provider: 'CUDA' },
    _meta: { title: 'PuLID-Flux InsightFace Loader (CUDA)' },
  },
  '22': {
    class_type: 'PulidFluxEvaClipLoader',
    inputs: {},
    _meta: { title: 'PuLID-Flux EVA-CLIP Loader' },
  },
  '23': {
    class_type: 'LoadImage',
    inputs: { image: 'characters/test/identity_00001_.png' },
    _meta: { title: 'Load Identity Reference Image' },
  },
  '24': {
    class_type: 'ApplyPulidFlux',
    inputs: {
      model: ['5', 0],
      pulid_flux: ['20', 0],
      eva_clip: ['22', 0],
      face_analysis: ['21', 0],
      image: ['23', 0],
      weight: 0.6,
      start_at: 0.0,
      end_at: 0.5,
    },
    _meta: {
      title: 'Apply PuLID-Flux (weight=0.6, end=0.5 — scene variation, more prompt freedom)',
    },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '', clip: ['2', 0] },
    _meta: { title: 'Positive prompt' },
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
  '10': {
    class_type: 'EmptySD3LatentImage',
    inputs: { width: 1024, height: 1024, batch_size: 1 },
    _meta: { title: 'Empty Latent (1024x1024, Flux/SD3 variant)' },
  },
  '11': {
    class_type: 'KSampler',
    inputs: {
      model: ['24', 0],
      seed: 1337,
      steps: 20,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      positive: ['8', 0],
      negative: ['9', 0],
      latent_image: ['10', 0],
      denoise: 1.0,
    },
    _meta: { title: 'KSampler (Flux: cfg=1.0, FluxGuidance handles real guidance)' },
  },
  '12': {
    class_type: 'VAEDecode',
    inputs: { samples: ['11', 0], vae: ['3', 0] },
    _meta: { title: 'VAE Decode' },
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
      image: ['12', 0],
      model: ['24', 0],
      clip: ['2', 0],
      vae: ['3', 0],
      positive: ['8', 0],
      negative: ['9', 0],
      bbox_detector: ['13', 0],
      sam_model_opt: ['14', 0],
      guide_size: 512,
      guide_size_for: true,
      max_size: 1024,
      seed: 1337,
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
    _meta: { title: 'FaceDetailer (final pass, denoise=0.35, feather=8)' },
  },
  '16': {
    class_type: 'SaveImage',
    inputs: {
      images: ['15', 0],
      filename_prefix: 'characters/test/variation',
    },
    _meta: { title: 'Save Image -> outputs/characters/<id>/variation_*' },
  },
};
