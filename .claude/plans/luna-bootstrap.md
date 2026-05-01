# Luna — bootstrap plan (Flux-first revisie)

## Context

Luna wordt een nieuwe lokale generatie-tool: **photorealistic persoon-generatie** (gezichten + lichamen) met character-consistency over honderden generaties. **Doel = candy.ai-tier kwaliteit, geen "in de buurt"**. Sister-project van **lumi** (port 18188, anime / semi-real, NoobAI-XL primary).

→ Luna = **realisme**, port **18190**, eigen ComfyUI-instance.

**Hardware-realiteit (RTX 4070, 12GB VRAM, 32GB RAM, 438GB vrij, CUDA 13.2):**
12GB haalt de **Tier-2 (candy.ai-equivalent)** stack — Flux.1 dev Q5_K_M GGUF + PuLID-Flux + skin-LoRA. Tier-3 (InfiniteYou / Flux BF16 / 24GB+) valt buiten bereik en is uit scope.

**Speed-realiteit:** 38–52s per 1024px Flux-gen op 4070. Acceptabel voor interactive UX, te traag voor batch >10/min — daar wijken we naar cloud uit.

**Lokaal vs cloud:** generatie = volledig lokaal. Character-LoRA training = **cloud (RunPod RTX 4090, ~$0.50–0.70 per run)** — lokaal Flux-LoRA training op 12GB werkt technisch (rank-64 / 768px / fp8-base / grad-ckpt / batch=1, ~3–4u per run) maar is fragile en duurder in tijd dan cloud.

## Pre-fase-1: lumi cleanup

Vóór luna-fase-1 start, één kleine cleanup in lumi (één reference vond ik):
- **`C:\Users\Clips\repos\lumi\infra\docker-compose.yml` regels 28-29**: comment over `infra_comfyui-data` named-volume noemt "before lumi-swap-comfyui forced a project rename" en "lumi-swap install-nodes.sh". Beide regels herschrijven naar een neutrale beschrijving (bv. "Named volume met FaceDetailer, IP-Adapter, en DINO+SAM custom-nodes").

Geen andere occurrences in lumi (`grep -i "lumi-swap|lumi_swap|18189|swap"` → 0 hits in CLAUDE.md, code of workflows). Dit is een 30-seconden edit zodra plan-mode uit is.

## Top-niveau stack-keuzes

**Generatie-engine:** Flux.1 dev GGUF Q5_K_M (~6.5GB) via `city96/ComfyUI-GGUF`. Niet SDXL.
- Flux is structureel beter dan SDXL op handen, lichaamsproporties, huid-subsurface
- Q5_K_M is sweet spot op 12GB (2.6 s/it = ~52s/1024px). Q4_0 sneller (~38s) maar zichtbaar kwaliteitsverlies.
- Q8 / fp8 past niet comfortabel naast PuLID + LoRAs op 12GB.

**NSFW fine-tunes (Civitai, gebruikt via GGUF-loader):**
- `Jib Mix Flux v12 SRPO` (Civitai 686814) — primary photoreal NSFW
- `Fluxed Up v10` (Civitai 847101) — alt voor diverse aesthetic

**Identity-lock:** **PuLID-Flux v1.1** (`balazik/ComfyUI-PuLID-Flux-Enhanced` of `cubiq/PuLID_ComfyUI`) — geen training nodig, inject-at-generation. Hoger ID-similarity dan IPAdapter+InstantID op Flux-modellen. ID Loss 0.225 vs InfiniteYou 0.209 (we gebruiken PuLID want InfiniteYou past niet in 12GB).

**Skin-detail booster:** `Photorealistic Skin No Plastic` Flux-LoRA (Civitai 1157318), strength 0.4–0.6. Lost het "AI-plastic" probleem op zonder pipeline-complexiteit.

**Image-edit / character-edit:** **Flux.1 Kontext FP8 via NVIDIA TensorRT** — past in 12GB op RTX 40-serie (Ada-architectuur), 2.1× sneller dan BF16 met 99.7% SSIM-behoud. Voor "verander outfit / scene op bestaande character image".

**Face refinement:** ComfyUI-Impact-Pack `FaceDetailer` als final pass voor close-ups (face-bbox >30% van frame).

**Character-LoRA (cloud):** Flux.1 dev rank-64 LoRA, 1024px, ~3000 steps op RunPod RTX 4090, ~60–90 min, ~$0.50–0.70 per run. Triggert vanaf 15+ accepted gens van zelfde character.

**SDXL-restpad:** alleen als legacy-fallback voor pose-controlled workflows (Flux pose-ControlNet ecosystem is per mei 2026 nog ondergedimensioneerd vs SDXL's OpenPoseXL2 + DWPose). Juggernaut XL Ragnarok blijft beschikbaar maar is niet de daily driver.

## Repo-structuur

```
C:\Users\Clips\repos\luna\
├── CLAUDE.md, README.md, Luna.bat, Stop-Luna.bat
├── .claude/agents/             # backend, frontend, researcher, qa, reviewer, fixer,
│                                 character-pipeline, prompt-engineer
├── apps/web/                   # Angular 21 standalone (skelet gekopieerd uit lumi)
│   └── src/app/{core, features/{characters,generate,edit,gallery}, shared}
├── infra/
│   ├── docker-compose.yml      # luna-comfyui op 18190
│   ├── install-nodes.sh        # ComfyUI-GGUF, PuLID-Flux, Impact-Pack, controlnet_aux,
│   │                             ComfyUI-FluxKontext (TensorRT-optimized), GGUF-LoRA loader
│   └── workflows/
│       ├── character-creation.json   # initial identity portrait (Flux + skin-LoRA)
│       ├── txt2img-character.json    # daily driver: Flux + PuLID-Flux + skin-LoRA + FaceDetailer
│       ├── scene-variation.json      # zelfde identity, andere scene (lower PuLID weight)
│       ├── character-edit.json       # Flux Kontext FP8 voor outfit/scene edits
│       ├── face-detail-only.json     # standalone FaceDetailer repair-pass
│       └── pose-controlled-sdxl.json # SDXL fallback voor pose-control (fase 5)
├── outputs/                    # eigen output-tree (niet delen met lumi)
├── scripts/
│   ├── download-models.mjs     # Flux GGUF Q5_K_M, Jib Mix, Fluxed Up, PuLID-Flux,
│   │                             Skin LoRA, T5-encoder, CLIP-L, Flux Kontext FP8 weights,
│   │                             TensorRT engine builder
│   ├── build-tensorrt.mjs      # one-time TensorRT engine compile voor Flux Kontext
│   ├── verify-identity.mjs     # InsightFace ArcFace cosine-similarity QA
│   ├── verify-anatomy.mjs      # YOLO-pose keypoint count check
│   ├── train-lora-cloud.mjs    # RunPod-API call: spin up RTX 4090 pod, push dataset,
│   │                             trigger kohya/ai-toolkit Flux-LoRA training, pull result
│   └── screenshot.mjs          # CDP UI-verificatie (kopie lumi)
└── training/
    ├── config/                 # ai-toolkit / kohya configs voor Flux-LoRA (cloud)
    ├── data/<character-id>/raw/
    └── output/<character-id>/  # gepullde LoRA-safetensors uit cloud
```

**Geen `models/` in luna zelf** — bind-mount `../lumi/models/` zodat de 57GB aan checkpoints niet gedupliceerd wordt. Flux-modellen worden naar `../lumi/models/unet/`, `../lumi/models/clip/`, `../lumi/models/vae/`, `../lumi/models/loras/`, `../lumi/models/pulid/` geschreven (Flux-conventions). Nooit overschrijven van bestaande bestanden.

## ComfyUI-instance & ports

| Project | Port | Rol |
|---|---|---|
| lumi | 18188 | anime txt2img |
| **luna** | **18190** | **photoreal persoon-gen (Flux)** |

Aparte container `luna-comfyui`, eigen named volume `luna-comfyui-data` (niet shared met lumi — Flux-stack heeft compleet andere custom-nodes dan lumi's anime SDXL-pipeline). GPU mag maar één instance tegelijk gebruiken op 12GB → `Luna.bat` start, `Stop-Luna.bat` stopt. Lumi moet down zijn als luna draait en vice versa.

Comfy startup-flags: `--listen 0.0.0.0 --enable-cors-header --reserve-vram 0.9 --use-pytorch-cross-attention --preview-method none`. Smart-memory **aan** laten — Flux + PuLID + LoRAs vereist sequential model-loading uit RAM.

## Custom nodes (geïnstalleerd via `infra/install-nodes.sh`)

| Node | Doel | Licentie |
|---|---|---|
| `city96/ComfyUI-GGUF` | Flux GGUF Q5_K_M loader + LoRA-merge | Apache 2.0 |
| `balazik/ComfyUI-PuLID-Flux-Enhanced` (of `cubiq/PuLID_ComfyUI`) | identity-lock (no training) | Apache 2.0 |
| `comfyanonymous/ComfyUI` core | Flux nodes (UNETLoader, DualCLIPLoader, etc.) | GPL-3.0 |
| ComfyUI-FluxKontext (officiële node-pack) | Flux.1 Kontext FP8 + TensorRT engine | Apache 2.0 |
| `ltdrdata/ComfyUI-Impact-Pack` | FaceDetailer | GPL-3.0 (flag licentie) |
| `Fannovel16/comfyui_controlnet_aux` | DWPose preprocessor (SDXL pose-fallback) | Apache 2.0 |
| `Kosinkadink/ComfyUI-Advanced-ControlNet` | timing/weighting (SDXL pose-fallback) | MIT |
| `Gourieff/ComfyUI-ReActor` | optionele face-swap post-pass (v2, AGPL-3.0) | flag licentie |

**Niet gebruikt** (anders dan in eerste planronde): IPAdapter Plus, InstantID — vervangen door PuLID-Flux. Reden: PuLID-Flux is single-stack op Flux, hogere fidelity, en SDXL-stacked workflows hebben we niet nodig als daily driver.

## Modellen — al aanwezig in `lumi/models/` (re-use)

`lustifySDXL_apexV8.safetensors` (SDXL fallback), `controlnet/instantid_controlnet.safetensors`, `controlnet/OpenPoseXL2.safetensors`, `insightface/models/antelopev2/` (nodig voor PuLID-Flux face-encoder!), `ultralytics/bbox/face_yolov8m.pt`.

## Modellen — downloaden (`scripts/download-models.mjs`, ~30GB Fase-1)

| Bestand | Doel | Grootte |
|---|---|---|
| `unet/flux1-dev-Q5_K_M.gguf` | **primary Flux base** | ~8.4GB |
| `clip/t5xxl_fp8_e4m3fn.safetensors` | T5-XXL text-encoder fp8 | ~5GB |
| `clip/clip_l.safetensors` | CLIP-L | ~250MB |
| `vae/ae.safetensors` | Flux VAE | ~335MB |
| `pulid/pulid_flux_v0.9.1.safetensors` | identity-injection | ~1.2GB |
| `clip/EVA02_CLIP_L_336_psz14_s6B.pt` | PuLID face-encoder | ~430MB |
| `loras/jibMixFlux_v12.safetensors` | NSFW photoreal fine-tune | ~7GB |
| `loras/fluxedUp_v10.safetensors` | NSFW alt | ~7GB |
| `loras/photorealisticSkinNoPlastic_flux.safetensors` | skin-detail booster | ~150MB |
| `flux-kontext/flux1-kontext-dev-fp8.safetensors` | character-edit engine | ~12GB |
| `tensorrt/flux-kontext-rtx40.engine` | TensorRT-compiled engine voor RTX 40-serie | ~8GB |
| `ultralytics/segm/person_yolov8m-seg.pt` | body-segm | ~52MB |
| `sams/sam_vit_b_01ec64.pth` | FaceDetailer SAM | ~375MB |
| `upscale_models/4x-UltraSharp.pth` | hires-fix | ~67MB |

**Fase-1 minimum (~22GB):** Flux GGUF + T5 + CLIP-L + VAE + PuLID + EVA-CLIP + Jib Mix + Skin LoRA + sam_vit_b. Geen Kontext, geen TensorRT, geen Fluxed Up, geen pose-fallback yet.

## VRAM-budget (12GB)

Gemeten benchmarks (RTX 4070-class, mei 2026 forums):

| Component | VRAM in actieve gen |
|---|---|
| Flux.1 dev Q5_K_M | ~6.5GB |
| + T5-XXL fp8 (sequential load) | piek bij text-encode +3.5GB, dan offload |
| + Skin LoRA + Jib Mix LoRA (rank-64) | +0.4GB |
| + PuLID-Flux (sequential) | +1.5GB tijdens face-extract, +0.8GB tijdens diffusion |
| + FaceDetailer (eigen mini-KSampler) | +1.8GB piek |
| + UltraSharp 1.5× (na VAEDecode) | minimal (model upscale, niet latent) |
| **Peak gecombineerd** | **~10.5–11.5GB** — krap maar werkt |

**Strategieën verplicht:**
- Sequential model loading (smart-memory aan)
- `batch_size=1` enforced; queue prompts ipv batchen
- T5 offloaden naar RAM/CPU na text-encoding (ComfyUI-GGUF doet dit automatisch)
- Hires-fix via `4x-UltraSharp` model-upscale **ná** VAEDecode (geen latent 2× tijdens stack)
- FaceDetailer mag in **separate workflow-call** als peak te hoog: gen → save → face-detail-only → save (verliest 3-4s I/O maar geen OOM)
- Max 2 LoRAs simultaan (skin + 1 fine-tune of skin + 1 character-LoRA)

## Subagents (`.claude/agents/`)

Hergebruik zes lumi-agents (kopiëren + paths/port re-scopen). **Voeg toe:**

- **`character-pipeline`** (NIEUW) — owner van `infra/workflows/character_*.json` en de Angular workflow-builders. Specialiseert in PuLID-Flux weight-tuning, Flux Kontext editing, FaceDetailer als final pass. Mag zowel JSON-workflows als TS workflow-builders aanraken.
- **`prompt-engineer`** (NIEUW) — owner van `STYLE_PREFIXES`, outfit/scene vocabularies, negative-prompt template. Flux gebruikt natural language (geen booru-tags), specifiek voor Jib Mix Flux / Fluxed Up trigger-words.
- **`cloud-trainer`** (NIEUW) — owner van `scripts/train-lora-cloud.mjs` + `training/config/`. Beheert RunPod API-keys (in `.env`), Flux-LoRA training-config templates (kohya / ai-toolkit), dataset-uploader, result-puller. Gescheiden van backend-agent want cloud-flow heeft eigen failure-modes.

Researcher/qa/reviewer/fixer ongewijzigd (alleen project-naam swap).

## CLAUDE.md hard rules (luna)

```
1. ComfyUI port: 18190. Container: luna-comfyui. Nooit "fixen" naar 8188.
2. Models bind-mount uit ../lumi/models/ — luna mag toevoegen, nooit overschrijven.
3. Default engine: Flux.1 dev GGUF Q5_K_M. SDXL alleen als pose-fallback.
4. Geen safety-rewrite checkpoints. SDXL-base, vanilla Flux-schnell, SD3.5 geblokkeerd.
5. Character-id-lock: zodra een character een identity-photo heeft, MOET elke generatie via
   buildCharacterWorkflow() gaan met PuLID-Flux. Plain txt2img alleen in
   "scene exploration" mode zonder character.
6. FaceDetailer is verplicht als laatste pass voor close-ups (face-bbox > 30% van frame).
7. Output minimum 1024×1024, hires-fix naar 1536px met UltraSharp model-upscale (geen
   latent 2× tijdens main stack — OOM-risico op 12GB).
8. NSFW ongecensureerd. Geen prompt-rewriting, geen NSFW-detector op output.
9. Negative-prompt template server-side enforced; user mag toevoegen, niet verwijderen.
10. VRAM-budget 12GB: max 2 LoRAs + PuLID-Flux + FaceDetailer per workflow.
    batch_size=1 verplicht; queue prompts ipv batchen.
11. Character-LoRA training is altijd cloud (RunPod RTX 4090). Lokale fallback alleen
    voor SDXL-LoRA, nooit voor Flux-LoRA.
12. Outputs naar luna/outputs/, nooit naar lumi/outputs/.
13. Strict TS, geen `any`, signals voor UI-state, Material 21 M3 dark.
14. Skin-LoRA (Photorealistic Skin No Plastic) altijd actief op weight 0.4–0.6 voor alle
    photoreal generaties — niet user-disableable in v1 (kwaliteitsfloor).
```

## Workflow-templates (kern)

- **`character-creation.json`** — Flux Q5 + Jib Mix(0.7) + Skin LoRA(0.5) → KSampler(steps=20, cfg=3.5, euler/simple) → VAEDecode → FaceDetailer → save als `characters/<id>/identity.png`.
- **`txt2img-character.json`** — Flux Q5 + Jib Mix(0.7) + Skin LoRA(0.5) + PuLID-Flux(weight 0.8, identity.png als ref) → KSampler(steps=20, cfg=3.5) → FaceDetailer → optional UltraSharp 1.5×.
- **`scene-variation.json`** — als boven, lower PuLID-weight (0.6) zodat scene/outfit meer ruimte krijgt.
- **`character-edit.json`** — Flux Kontext FP8 + TensorRT engine + identity.png + edit-prompt ("change outfit to red dress") → output. Geen FaceDetailer (Kontext doet face-preserve intern).
- **`face-detail-only.json`** — standalone repair op bestaande output, ~10s op 4070.
- **`pose-controlled-sdxl.json`** (fase 5 fallback) — Juggernaut XL + IPAdapter-FaceID + InstantID + DWPose (alleen als Flux pose-CN niet volwassen genoeg blijkt).

## Frontend feature-set v1

Vier routes, signals/services-patroon 1:1 van lumi:

- **`/characters`** — `CharactersComponent` + `CharacterDialog` met candy.ai velden: ethnicity, age-band, hair-color/style, eye-color, body-type, breast-size, butt-size, personality-tags, default-outfit. Per character: `identity.png` (PuLID-anchor) + photo-history.
- **`/generate`** — character-picker bovenaan (verplicht). Velden: scene, outfit (overschrijft default), pose-text (free-text in v1), shot (portrait/half/full), mood, NSFW-toggle. Bouwt `txt2img-character.json` of `scene-variation.json`.
- **`/edit`** — character-edit via Flux Kontext: kies bestaand image + edit-prompt → nieuwe variant met identity-preserved.
- **`/gallery`** — sessie-output met character-filter dropdown.

**1:1 te kopiëren uit lumi:** `comfy.service.ts`, `session.service.ts`, `gallery/`, `app.config.ts`, environment skelet (port → 18190), Material M3 dark theme, build-config.

**Aanpassen:** `app.routes.ts` (vier routes), `Character` interface (extra velden), `generator.ts` herschreven als `generate.ts` met character-lock guard, nieuwe `EditComponent` voor Flux Kontext.

## QA-scripts

- **`verify-identity.mjs`** — InsightFace ArcFace cosine-similarity tussen `identity.png` en output. **≥0.65 pass** (hoger dan SDXL-norm 0.55, want PuLID levert betere similarity), <0.50 fail+regenerate, 0.50–0.65 flag. Loopt automatisch op iedere generation in dev-mode.
- **`verify-anatomy.mjs`** — YOLO-pose op output, count COCO-17 keypoints. <12 zichtbaar zonder occlusion → flag. Flux is sterk op anatomie maar niet onfeilbaar.
- **`verify-skin-quality.mjs`** (nieuw) — heuristic op skin-region: hoge-frequentie content (FFT laplacian-variance) — als <threshold dan "plastic skin" flag, suggesteer Skin LoRA strength verhogen.
- **`screenshot.mjs`** — kopie lumi, CDP UI-verificatie.

## Roadmap (gefaseerd, harde dependencies)

**Pre-fase-1 (1 dag):** lumi cleanup — `lumi/infra/docker-compose.yml` regel 28-29 lumi-swap reference verwijderen.

**Fase 1 — week 1–2 (Flux foundation):** repo-skelet + Angular kopie + `infra/docker-compose.yml` (port 18190) + `install-nodes.sh` (ComfyUI-GGUF, PuLID-Flux, Impact-Pack) + `download-models.mjs` (Flux Q5 + T5 + CLIP-L + VAE + PuLID + EVA-CLIP + Jib Mix + Skin LoRA) + `character-creation.json` werkend + `txt2img-character.json` v1 met PuLID-Flux + Skin LoRA. **Validatie:** Sofia-character met identity-photo + 5 scene-gens, alle gezicht-similar (eyeball-test + verify-identity.mjs ≥0.65). **Geen hard dep.**

**Fase 2 — week 3–4 (UI + identity-flow):** Angular character-builder UI met identity-portretpreview + regen-knop + accept-flow. `/generate` met character-picker en scene/outfit-form. `face-detail-only.json` standalone. `verify-identity.mjs` + `verify-anatomy.mjs` lopen automatisch. `/gallery` met character-filter. **Hard dep:** Fase-1 PuLID-Flux werkend.

**Fase 3 — week 5–6 (Flux Kontext editing):** TensorRT engine builden voor Flux Kontext FP8 (`scripts/build-tensorrt.mjs`), `character-edit.json` werkend, `/edit` route in UI met before/after preview. `verify-skin-quality.mjs`. Hires-fix UltraSharp integreren. Negative-prompt server-side enforcement. **Hard dep:** Fase-2 stable identity-output.

**Fase 4 — week 7–8 (cloud LoRA training):** `scripts/train-lora-cloud.mjs` met RunPod API (spin pod, push dataset, run kohya/ai-toolkit Flux-LoRA, pull result). Auto-dataset-builder UI: gebruiker selecteert ≥30 favorites uit gallery → captioner (BLIP-3 / Florence-2) → trigger training. LoRA-merge in workflow vóór PuLID-stack (LoRA strength 0.6 + PuLID 0.8 = SOTA combo per research). **Hard dep:** Fase-2 + ≥30 accepted gens per character + RunPod API-key in `.env`. **Kosten-estimate:** ~$0.50–0.70 per character-LoRA.

**Fase 5 — backlog/v2:** SDXL pose-controlled fallback (alleen als Flux ControlNet ecosystem onvoldoende blijkt voor specifieke poses), ReActor face-swap (alleen als PuLID-Flux identity-fail-rate >10%), FluxedUp v10 als alternatief checkpoint, BigASP v3 als nog later 2026 release het waard maakt.

## Out-of-scope v1

Expliciet **niet**: video-generatie (Wan/CogVideo), voice/TTS, chat/LLM-interface, mobile/responsive UI, public hosting, multi-user/auth, payment/credits, content-moderation, lokale Flux-LoRA training, InfiniteYou (past niet in 12GB).

## Verificatie (end-to-end)

1. `docker compose up -d` in `luna/infra/` → `curl http://localhost:18190/system_stats` → 200 OK met GPU info.
2. `node scripts/download-models.mjs` → Fase-1 modellen aanwezig in `../lumi/models/{unet,clip,vae,pulid,loras}`.
3. UI op `npm start` → `http://localhost:4200/characters` → maak character "Sofia" met candy.ai-velden → klik **Create Identity** → portretfoto in <60s, scherp huiddetail (geen plastic look).
4. Switch naar `/generate`, kies Sofia, vul scene "kitchen, morning light", outfit "white t-shirt and jeans" → klik Generate → output in <60s, gezicht herkenbaar als Sofia (cosine ≥0.65).
5. `/edit`: kies Sofia gen → prompt "change outfit to red evening dress" → Kontext-output behoudt gezicht.
6. `node scripts/verify-identity.mjs --character sofia --output <pad>` → cosine ≥0.65 op alle.
7. FaceDetailer-pass standalone: bestaande low-quality face → `face-detail-only.json` → scherper face binnen 10s.
8. Cloud-LoRA flow (Fase 4): selecteer 30 Sofia-gens → trigger → RunPod pod start → 60–90 min later `training/output/sofia/sofia_v1.safetensors` lokaal → activeer in `/generate` → vergelijkbare-of-betere identity-similarity dan PuLID-alone.

## Critical files (te creëren in fase 1)

- `C:\Users\Clips\repos\luna\CLAUDE.md`
- `C:\Users\Clips\repos\luna\infra\docker-compose.yml`
- `C:\Users\Clips\repos\luna\infra\install-nodes.sh`
- `C:\Users\Clips\repos\luna\infra\workflows\character-creation.json`
- `C:\Users\Clips\repos\luna\infra\workflows\txt2img-character.json`
- `C:\Users\Clips\repos\luna\scripts\download-models.mjs`
- `C:\Users\Clips\repos\luna\scripts\verify-identity.mjs`
- `C:\Users\Clips\repos\luna\apps\web\src\app\features\characters\character.dialog.ts`
- `C:\Users\Clips\repos\luna\apps\web\src\app\features\generate\generate.ts`
- `C:\Users\Clips\repos\luna\apps\web\src\app\features\edit\edit.ts`
- `C:\Users\Clips\repos\luna\apps\web\src\app\core\character.service.ts`
- `C:\Users\Clips\repos\luna\.claude\agents\character-pipeline.md`
- `C:\Users\Clips\repos\luna\.claude\agents\prompt-engineer.md`
- `C:\Users\Clips\repos\luna\.claude\agents\cloud-trainer.md`

## Critical files (referentie, te kopiëren/inspireren uit lumi)

- `C:\Users\Clips\repos\lumi\CLAUDE.md` — hard rules patroon
- `C:\Users\Clips\repos\lumi\infra\docker-compose.yml` — Docker template (port 18188 → 18190; LET OP: regel 28-29 cleanup eerst)
- `C:\Users\Clips\repos\lumi\infra\workflows\txt2img.json` + `ip_adapter.json` — workflow-JSON basis (al is luna's stack Flux ipv SDXL)
- `C:\Users\Clips\repos\lumi\apps\web\src\app\core\comfy.service.ts` — ComfyUI client
- `C:\Users\Clips\repos\lumi\apps\web\src\app\core\character.service.ts` — character store basis
- `C:\Users\Clips\repos\lumi\scripts\screenshot.mjs` — CDP UI-verificatie patroon
- `C:\Users\Clips\repos\lumi\training-config\anime_config.json` — VRAM-aware OneTrainer-flags (referentie voor cloud-training config)

`infra/install-nodes.sh`, `scripts/download-models.mjs`, `scripts/train-lora-cloud.mjs` zijn nieuw voor luna — bouwen vanaf scratch.

## Belangrijkste afwegingen versus eerste plan

| Onderwerp | Eerste plan | Herziene plan | Reden |
|---|---|---|---|
| Base-engine | SDXL Juggernaut Ragnarok | **Flux.1 dev Q5_K_M GGUF** | Flux is structureel beter op anatomie/handen/skin; 12GB haalbaar via GGUF |
| Identity-lock | IPAdapter FaceID + InstantID stacked | **PuLID-Flux v1.1** | Hogere fidelity, single-stack op Flux, geen training |
| Skin-detail | impliciet via checkpoint | **expliciete Skin-LoRA always-on** | "Plastic skin" is de #1 verraad-tell; LoRA kost ~150MB en lost het op |
| Image-edit | niet in v1 | **Flux Kontext FP8 + TensorRT in fase 3** | NVIDIA TensorRT past Kontext in 12GB RTX 40-serie |
| LoRA-training | lokaal op 12GB in fase 4 | **cloud RunPod RTX 4090 in fase 4** | Lokaal Flux-LoRA op 12GB werkt maar is fragile + duurder in tijd dan $0.70 cloud |
| Quality-tier | "good enough op 12GB" | **expliciet candy.ai-equivalent (Tier 2)** | Tier 3 (InfiniteYou/Flux BF16) buiten scope want vereist 16GB+ |
