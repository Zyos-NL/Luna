# Luna — Local Photoreal Person Generator

## Product Vision
Luna is a self-hosted, **photorealistic** person generator. Build a character (look, body, personality), pin its identity once, and generate hundreds of consistent images across scenes, outfits, poses and moods — locally, ungecensored, no cloud.

Reference standard: **candy.ai-tier kwaliteit**. Niet "in de buurt" — daadwerkelijk vergelijkbare photoreal output, met character-consistency over honderden generaties.

Sister project: [Lumi](../lumi/) — anime/semi-real generator. Lumi en Luna delen ComfyUI-infra patroon en de `models/` folder (bind-mount), maar gebruiken **verschillende stacks**: Lumi = SDXL/NoobAI-XL (anime), Luna = **Flux.1 dev GGUF** (photoreal). Lumi en Luna draaien op verschillende ComfyUI-poorten (18188 vs 18190) en kunnen niet tegelijk actief zijn (12GB VRAM).

## Two core promises

1. **Character-id-lock.** Zodra een character een identity-photo heeft, behoudt elke generatie het gezicht — via PuLID-Flux (geen training) en optioneel cloud-getrainde character-LoRA.
2. **Candy.ai-tier photoreal.** Geen "AI-plastic" skin, anatomisch correcte handen/proporties, scherpe gezichten. Bereikt via Flux.1 dev + NSFW-finetune + Skin-LoRA + FaceDetailer als final pass.

## Stack
- **Frontend:** Angular 21 standalone, strict TypeScript, signals, Material 21 M3 dark.
- **AI backend:** ComfyUI (Docker, NVIDIA CUDA) op poort **18190**.
- **Engine:** Flux.1 dev GGUF Q5_K_S (`unet/flux1-dev-Q5_K_S.gguf`, ~7.9GB) via `city96/ComfyUI-GGUF`. SDXL alleen als pose-fallback. NB: city96 publiceert geen Q5_K_M voor Flux dev — Q5_K_S is de juiste K-quant 5-bit keuze.
- **Identity-lock:** PuLID-Flux v0.9.1 weight via `lldacing/ComfyUI_PuLID_Flux_ll` (active Flux fork; `balazik/ComfyUI-PuLID-Flux-Enhanced` bestaat niet, `sipie800/...-Enhanced` is discontinued).
- **T5 encoder:** `t5xxl_fp8_e4m3fn.safetensors` (FP8 safetensors). NIET Q5_K_M GGUF — combinatie met FP8/GGUF Flux UNet OOM-t op 12GB.
- **Skin-detail:** "Photorealistic Skin No Plastic" Flux-LoRA always-on (weight 0.4–0.6).
- **NSFW finetune:** Jib Mix Flux v12 SRPO (primary) of Fluxed Up v10 (alt).
- **Image-edit:** Flux.1 Kontext dev GGUF Q5_K_S via `city96/ComfyUI-GGUF` loader, mirror `QuantStack/FLUX.1-Kontext-dev-GGUF`. NIET TensorRT (LoRA-incompat dealbreaker — Skin-LoRA always-on per rule #14). Native Flux Kontext nodes (`FluxKontextImageScale`, `ReferenceLatent`) zitten in ComfyUI core sinds v0.3.40.
- **Character-LoRA:** cloud (RunPod RTX 4090, ~$0.50–0.70/run, 60–90 min). Geen lokale Flux-LoRA training.
- **Models:** bind-mount `../lumi/models/`. Geen duplicate models-folder.
- **Communication:** Angular → ComfyUI via WebSocket + HTTP. Geen ASP.NET / Node backend.

## Generation modes (UI volgorde, niet wijzigen)
1. **Scene generation** *(default)* — kies character, vul scene + outfit + pose-text + shot + mood. Bouwt `txt2img-character.json` (Flux + PuLID-Flux + Skin-LoRA + FaceDetailer).
2. **Scene variation** — zelfde character, ander scene. Lower PuLID-weight zodat scene meer ruimte krijgt. Bouwt `scene-variation.json`.
3. **Edit** — kies bestaand image van character + edit-prompt ("change outfit to red dress"). Bouwt `character-edit.json` met Flux Kontext FP8.

## Hard rules (every agent must follow)
1. **ComfyUI port: 18190.** Container: `luna-comfyui`. Nooit "fixen" naar 8188 (= Lumi).
2. **Models bind-mount uit `../lumi/models/`** — luna mag toevoegen, **nooit overschrijven** van bestaande bestanden. Download-script doet `Test-Path` check.
3. **Default engine: Flux.1 dev GGUF Q5_K_S.** SDXL alleen als pose-controlled-fallback.
4. **Geen safety-rewrite checkpoints.** SDXL-base, vanilla Flux-schnell, SD3.5 geblokkeerd in de UI.
5. **Character-id-lock.** Zodra een character een `identity.png` heeft, MOET elke generatie via `buildCharacterWorkflow()` gaan met PuLID-Flux. Plain txt2img zonder character is alleen "scene exploration" mode.
6. **FaceDetailer verplicht** als laatste pass voor close-ups (face-bbox > 30% van frame).
7. **Output minimum 1024×1024**, hires-fix naar 1536px met UltraSharp model-upscale (geen latent 2× tijdens main stack — OOM op 12GB).
8. **NSFW ongecensureerd.** Geen prompt-rewriting, geen NSFW-detector op output.
9. **Negative-prompt template server-side enforced**; user mag toevoegen, niet verwijderen.
10. **VRAM-budget 12GB.** Max 2 LoRAs + PuLID-Flux + FaceDetailer per workflow. `batch_size=1` verplicht — queue prompts ipv batchen.
11. **Character-LoRA training is altijd cloud** (RunPod RTX 4090). Lokale fallback alleen voor SDXL-LoRA, nooit voor Flux-LoRA.
12. **Outputs naar `luna/outputs/`**, nooit naar `lumi/outputs/`.
13. **Strict TS, geen `any`**, signals voor UI-state, Material 21 M3 dark.
14. **Skin-LoRA** ("Photorealistic Skin No Plastic") altijd actief op weight 0.4–0.6 voor photoreal generaties — niet user-disableable in v1 (kwaliteitsfloor).
15. **PNG-encoding van masks/uploads off the main thread** via worker indien geïntroduceerd (4K masks blokkeren UI 200–400 ms).

## Repo layout
```
luna/
├── CLAUDE.md, README.md, Luna.bat, Stop-Luna.bat
├── .claude/agents/             # 9 subagents — zie .claude/agents/*.md
├── apps/web/                   # Angular 21 frontend (standalone, signals, Material M3)
│   └── src/app/{core, features/{characters,generate,edit,gallery}, shared}
├── infra/
│   ├── docker-compose.yml      # luna-comfyui op 18190, bind-mount ../lumi/models/
│   ├── install-nodes.sh        # ComfyUI-GGUF, PuLID-Flux, Impact-Pack, controlnet_aux
│   ├── .env.example            # RUNPOD_API_KEY, CIVITAI_TOKEN, HF_TOKEN
│   └── workflows/
│       ├── character-creation.json   # initial identity portrait
│       ├── txt2img-character.json    # daily driver
│       ├── scene-variation.json      # zelfde identity, ander scene
│       ├── character-edit.json       # Flux Kontext FP8 edits
│       ├── face-detail-only.json     # standalone repair-pass
│       └── pose-controlled-sdxl.json # SDXL fallback voor pose-control
├── outputs/                    # ComfyUI output (volume mount)
├── scripts/
│   ├── download-models.mjs     # Flux GGUF + T5 + CLIP-L + VAE + PuLID + LoRAs
│   ├── verify-identity.mjs     # InsightFace cosine-similarity QA (≥0.65)
│   ├── verify-anatomy.mjs      # YOLO-pose keypoint count
│   ├── train-lora-cloud.mjs    # RunPod RTX 4090 character-LoRA pipeline
│   └── screenshot.mjs          # CDP UI-verificatie
└── training/
    ├── config/                 # ai-toolkit / kohya configs voor cloud-LoRA
    ├── data/<character-id>/raw/
    └── output/<character-id>/  # gepullde LoRA-safetensors uit cloud
```

## How to develop
Use de project subagents in `.claude/agents/`:
- **frontend** — Angular code (components, signals, services, SCSS).
- **backend** — ComfyUI workflows, custom nodes, Docker, model downloads.
- **character-pipeline** — eigenaar van `infra/workflows/character_*.json` + Angular workflow-builders. Specialiseert in PuLID-Flux + FaceDetailer + Flux Kontext.
- **prompt-engineer** — `STYLE_PREFIXES`, outfit/scene vocabularies, negative-prompt template. Flux uses natural language (geen booru-tags).
- **cloud-trainer** — RunPod cloud-LoRA pipeline (`scripts/train-lora-cloud.mjs` + `training/config/`).
- **researcher** — model + custom-node research, photoreal SOTA per 2026.
- **reviewer** — read-only code review tegen hard rules.
- **fixer** — past reviewer-feedback toe, runs build/test tot groen.
- **qa** — end-to-end verify: identity-cosine ≥0.65, anatomy keypoints, skin-quality FFT.

Standaard loop: implement (frontend / backend / character-pipeline) → review → fix → qa → push.

## Quality standard
- Photoreal, no anime/painterly drift. Skin met zichtbare pores en natural shading, niet plastic-smooth.
- Mask-edges feathered (`MaskBlur` na `GrowMask`) voor edit-workflows.
- Negative-prompt template (server-side):
  `"anime, cartoon, illustration, painting, 3d render, cgi, plastic skin, deformed, mutated, extra fingers, fused fingers, bad anatomy, bad hands, malformed, asymmetric eyes, cross-eyed, blurry, low quality, jpeg artifacts, watermark, text, signature"`
- Identity-similarity threshold: cosine ≥0.65 (PuLID-Flux levert hoger dan SDXL+IPAdapter; we zetten lat hoger).

## Bewust uit scope (v1)
- Video-generatie (Wan/CogVideo/AnimateDiff). 
- Voice/TTS, chat/LLM-interface.
- Lokale Flux-LoRA training (cloud-only).
- InfiniteYou (vereist 16GB+ VRAM, niet haalbaar op RTX 4070).
- Mobile / responsive UI. Desktop-first.
- Multi-user / auth / payment / hosting.
- Automatische dataset-scraping.

## Hardware
RTX 4070 12GB, i7-13700K, 32GB RAM, 438GB+ vrij, CUDA 13.2, Docker met NVIDIA runtime, Node 24, Python 3.12. Flux.1 dev Q5_K_S = ~52s/1024px. Tier-2 (candy.ai-equivalent) haalbaar; Tier-3 (Flux BF16 / InfiniteYou / 24GB+) buiten scope.
