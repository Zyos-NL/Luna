# Luna — Handoff (status & next session instructions)

Dit document beschrijft de **huidige bootstrap-status** van luna en geeft de **next steps** voor een verse Claude Code sessie. Lees dit eerst, dan `CLAUDE.md`, dan `.claude/plans/luna-bootstrap.md`.

## Voor de eerstvolgende Claude-sessie

1. **Open een nieuwe Claude Code sessie vanuit `C:\Users\Clips\repos\luna`** — dan wordt:
   - Memory automatisch geladen uit `C:\Users\Clips\.claude\projects\c--Users-Clips-repos-luna\memory\`
   - Plan beschikbaar via `.claude/plans/luna-bootstrap.md`
   - Subagents werkend uit `.claude/agents/` (9 stuks)
   - Auto-approve voor Write/Edit op `C:\Users\Clips\**` paths actief via `.claude/settings.local.json`

2. **Zeg in de eerste prompt iets als**:
   > "Lees HANDOFF.md, CLAUDE.md en `.claude/plans/luna-bootstrap.md`. Begin met de pending items uit HANDOFF onder 'Next steps' — start bij Fase 1: infra/docker-compose.yml + install-nodes.sh + download-models.mjs."

3. **De cwd-anchor** van de oude sessie was `lumi-swap` (legacy folder, kan weg). Mocht dat folder nog bestaan en je wilt 'm verwijderen: dat is een **destructieve actie**, doe dat handmatig of vraag de Claude in de nieuwe sessie expliciet.

## Wat er staat (✅ klaar)

### Repo & connectie
- `C:\Users\Clips\repos\luna` aangemaakt, `git init -b main`, remote `origin` = `https://github.com/Zyos-NL/Luna.git`
- Plan + memory geanchored in luna én in `~/.claude/projects/c--Users-Clips-repos-luna/`

### Top-level files
- `CLAUDE.md` — full product vision, hard rules (15 stuks), repo layout, generation modes, quality standard, scope, hardware
- `README.md` — quick-start, stack samenvatting
- `Luna.bat` — one-click launch (Docker + ng serve + open browser)
- `Stop-Luna.bat` — stops `luna-comfyui` container (vrijgeven GPU voor lumi)
- `.gitignore` — node_modules, models/, outputs/, screenshots/, training/data, training/output, tokens (`.env`, `.civitai-token`, `.runpod-token`, `.hf-token`), `.claude/settings.local.json`
- `HANDOFF.md` — dit bestand

### Subagents (`.claude/agents/`, 9 stuks)
1. **backend** — Docker/ComfyUI/install-nodes/downloads (NIET cloud-training)
2. **frontend** — Angular 21 standalone, signals, port 18190
3. **character-pipeline** — PuLID-Flux + FaceDetailer + Flux Kontext workflows + workflow-builders
4. **prompt-engineer** — Flux natural-language prompts, negative-baseline, scene/outfit vocab
5. **cloud-trainer** — RunPod RTX 4090 LoRA-training pipeline (`scripts/train-lora-cloud.mjs`)
6. **researcher** — model/LoRA/SOTA research (read-only)
7. **qa** — end-to-end verify met identity-cosine ≥0.65, anatomy keypoints, skin FFT
8. **reviewer** — code-diff review tegen hard rules (read-only)
9. **fixer** — past reviewer-feedback toe, runs build tot groen

### Plan + memory
- `.claude/plans/luna-bootstrap.md` — volledige Flux-first architectuur plan (kopie van de approved plan)
- Memory in `~/.claude/projects/c--Users-Clips-repos-luna/memory/`:
  - `MEMORY.md` (index)
  - `feedback_tool_permissions.md` (auto-execute shell/git zonder per-call confirm)
  - `project_lumi_swap_deprecated.md` (lumi-swap repo bestaat niet meer)

### Settings
- `.claude/settings.local.json` — auto-approve Write/Edit voor alle paths onder `C:\Users\Clips\` (Windows + Unix path-formats). In `.gitignore`, niet gecommit.

### Lumi cleanup (sister project)
- ✅ `C:\Users\Clips\repos\lumi\infra\docker-compose.yml` regels 28-29: lumi-swap-referentie verwijderd uit comment.

## Wat er nog moet gebeuren (⏳ pending)

In volgorde van Fase-1 prio uit het plan:

### 1. Infra (`infra/`)
- [ ] `infra/docker-compose.yml` — service `comfyui`, container `luna-comfyui`, port `18190:8188`, GPU passthrough, bind-mount `../../lumi/models:/root/ComfyUI/models`, named-volume `luna-comfyui-data:/root/ComfyUI/custom_nodes`, CLI args `--listen 0.0.0.0 --enable-cors-header --reserve-vram 0.9 --use-pytorch-cross-attention --preview-method none`. Image: `yanwk/comfyui-boot:cu130-slim` (zelfde als lumi).
- [ ] `infra/install-nodes.sh` — clone + pip install in `luna-comfyui` container:
  - `city96/ComfyUI-GGUF` (Flux GGUF loader)
  - `balazik/ComfyUI-PuLID-Flux-Enhanced` (identity-lock)
  - `ltdrdata/ComfyUI-Impact-Pack` (FaceDetailer)
  - `Fannovel16/comfyui_controlnet_aux` (DWPose, voor SDXL fallback)
  - `Kosinkadink/ComfyUI-Advanced-ControlNet` (timing/weighting)
  - ComfyUI-FluxKontext (TensorRT) — repo te zoeken via researcher agent
- [ ] `infra/.env.example` — RUNPOD_API_KEY, CIVITAI_TOKEN, HF_TOKEN placeholders

### 2. Scripts (`scripts/`)
- [ ] `scripts/download-models.mjs` — Fase-1 minimum (~22GB):
  - `unet/flux1-dev-Q5_K_M.gguf` (city96/FLUX.1-dev-gguf op HuggingFace)
  - `clip/t5xxl_fp8_e4m3fn.safetensors` (comfyanonymous repo)
  - `clip/clip_l.safetensors`
  - `vae/ae.safetensors`
  - `pulid/pulid_flux_v0.9.1.safetensors`
  - `clip/EVA02_CLIP_L_336_psz14_s6B.pt` (PuLID face-encoder)
  - `loras/jibMixFlux_v12.safetensors` (Civitai 686814)
  - `loras/photorealisticSkinNoPlastic_flux.safetensors` (Civitai 1157318)
  - `sams/sam_vit_b_01ec64.pth`
  - `ultralytics/segm/person_yolov8m-seg.pt`
  - `upscale_models/4x-UltraSharp.pth`
  - Gebruik `Test-Path` check, **nooit** overschrijven van bestaand bestand in `../lumi/models/`
- [ ] `scripts/verify-identity.mjs` — InsightFace ArcFace cosine-similarity tussen `identity.png` en output, threshold ≥0.65
- [ ] `scripts/verify-anatomy.mjs` — YOLO-pose COCO-17 keypoint count ≥12
- [ ] `scripts/screenshot.mjs` — kopie van `lumi/scripts/screenshot.mjs`, paths aanpassen naar luna en COMFY_URL naar `http://localhost:18190`
- [ ] `scripts/train-lora-cloud.mjs` — stub voor Fase 4 (RunPod-API), kan later

### 3. ComfyUI Workflows (`infra/workflows/`)
Bouwen op echte ComfyUI API JSON format. Test eerst handmatig in ComfyUI UI (`http://localhost:18190`) voor 1 character, exporteer als API-format JSON, sla op:
- [ ] `infra/workflows/character-creation.json` — Flux Q5 + Jib Mix(0.7) + Skin LoRA(0.5) → KSampler(20 steps, cfg 3.5, euler/simple) → VAEDecode → FaceDetailer → SaveImage met `filename_prefix=characters/<id>/identity`
- [ ] `infra/workflows/txt2img-character.json` — als boven + PuLID-Flux (weight 0.8, end 0.7, ref=identity.png)
- [ ] `infra/workflows/scene-variation.json` — txt2img-character met PuLID weight 0.6, end 0.5
- [ ] `infra/workflows/character-edit.json` — Flux Kontext FP8 + TensorRT engine + identity.png + edit-prompt (Fase 3, build-tensorrt.mjs eerst)
- [ ] `infra/workflows/face-detail-only.json` — standalone FaceDetailer-pass

### 4. Angular skeleton (`apps/web/`)
Kopiëren uit lumi en aanpassen. Baseline:
- [ ] Initialiseer `apps/web/` met Angular 21 standalone (kopie van `lumi/apps/web/{angular.json,package.json,tsconfig*.json,public/}`, project-name `luna-web` ipv `lumi-web`)
- [ ] `apps/web/src/{index.html,main.ts,styles.scss}` — kopie, title "LunaWeb"
- [ ] `apps/web/src/environments/environment.ts` — `comfyUrl: 'http://localhost:18190'`
- [ ] `apps/web/src/app/app.config.ts` — kopie 1:1 (provideRouter, provideHttpClient, provideAnimationsAsync)
- [ ] `apps/web/src/app/app.routes.ts` — vier routes: `/characters`, `/generate`, `/edit`, `/gallery`. Default redirect naar `/characters`.
- [ ] `apps/web/src/app/app.ts` — toolbar zonder `TrainerService` chip (cloud-training is async background, geen status-chip nodig). ComfyUI-chip met port 18190 in tooltip.
- [ ] `apps/web/src/app/core/comfy.service.ts` — kopie van lumi, port 18190 (via environment).
- [ ] `apps/web/src/app/core/session.service.ts` — kopie 1:1 + extra `characterId` field in SessionImage.
- [ ] `apps/web/src/app/core/character.service.ts` — uitbreiding van lumi's: extra Character velden (`ethnicity`, `ageBand`, `hairColor`, `hairStyle`, `eyeColor`, `bodyType`, `breastSize`, `buttSize`, `personalityTags`, `defaultOutfit`, `identityFilename`).
- [ ] `apps/web/src/app/core/workflow.service.ts` — bouwt vier workflows (character-creation, txt2img-character, scene-variation, character-edit) door JSON-templates uit `infra/workflows/` te laden + parameters in te vullen. Server-side enforced negative-baseline.
- [ ] `apps/web/src/app/features/characters/characters.ts` + `character.dialog.ts` — character grid + builder met candy.ai-velden + identity-portretpreview
- [ ] `apps/web/src/app/features/generate/generate.ts` — character-picker (verplicht, `hasIdentity()` computed), scene + outfit + pose-text + shot + mood form, Generate-knop, progress bar
- [ ] `apps/web/src/app/features/edit/edit.ts` — kies character + bestaand image + edit-prompt → Flux Kontext (Fase 3)
- [ ] `apps/web/src/app/features/gallery/gallery.ts` — sessie-output + character-filter dropdown

### 5. Eerste working flow (Fase 1 validatie)
- [ ] `docker compose up -d` → ComfyUI op 18190 reachable
- [ ] `bash infra/install-nodes.sh` → custom nodes geïnstalleerd
- [ ] `node scripts/download-models.mjs` → Fase-1 modellen aanwezig
- [ ] `cd apps/web && npm install && npm start` → UI op 4200
- [ ] Maak character "Sofia" → klik Create Identity → portret in <60s, photoreal, geen plastic skin
- [ ] Switch naar `/generate`, kies Sofia, scene "kitchen morning, white t-shirt" → output in <60s, gezicht-similarity tegen identity ≥0.65

## Aanbevolen werkvolgorde voor de volgende sessie

**Sessie 1 (1-2 uur):**
1. Lees HANDOFF.md, CLAUDE.md, plan
2. Spawn `backend` subagent: bouw `infra/docker-compose.yml` + `infra/install-nodes.sh` + `infra/.env.example`
3. Test `docker compose up -d`, check `curl http://localhost:18190/system_stats` → 200 OK
4. Spawn `backend` subagent: bouw `scripts/download-models.mjs` (Fase-1 minimum)
5. Run download-models — duurt ~30 min op gemiddelde verbinding (~22GB)

**Sessie 2 (2-3 uur):**
6. Open ComfyUI op `http://localhost:18190`, bouw handmatig de eerste txt2img-character workflow met Flux Q5 + Jib Mix + Skin LoRA + PuLID-Flux (volg `.claude/agents/character-pipeline.md` weights). Test met een prompt. Exporteer API-format JSON.
7. Spawn `character-pipeline` subagent: sla geëxporteerde JSON op in `infra/workflows/character-creation.json` en `txt2img-character.json`. Verfijn op basis van output-kwaliteit.

**Sessie 3 (4-6 uur):**
8. Spawn `frontend` subagent: bouw Angular skeleton (kopieer + adapt uit lumi). Vier routes, character.service uitgebreid, workflow.service met JSON-templates.
9. Spawn `qa` subagent: verifieer end-to-end Sofia-flow.

**Sessie 4+:** Fase 2 (UI polish + identity-flow), Fase 3 (Flux Kontext), Fase 4 (cloud-LoRA).

## Belangrijke pointers (cheat sheet)

- **ComfyUI port: 18190.** Lumi = 18188. **Niet** 18189 (lumi-swap bestaat niet meer).
- **Models bind-mount uit `../lumi/models/`** — luna mag toevoegen, **nooit** overschrijven.
- **Engine: Flux.1 dev GGUF Q5_K_M** via `city96/ComfyUI-GGUF`. Geen SDXL als daily driver.
- **Identity: PuLID-Flux v1.1**. Geen IPAdapter+InstantID stack.
- **Skin-LoRA always-on** op weight 0.4–0.6 (kwaliteitsfloor).
- **Character-LoRA training: cloud RunPod** (~$0.70/run). Lokale Flux-LoRA training niet doen.
- **GPU-mutex**: lumi en luna kunnen niet tegelijk draaien (12GB VRAM). Stop lumi voor je luna start.
- **VRAM-budget**: peak ~10.5–11.5GB. batch_size=1 verplicht.
- **Identity-cosine threshold: ≥0.65** (PuLID levert hoger dan SDXL+IPAdapter).
- **NSFW ongecensureerd** — geen prompt-rewriting, geen safety-filters.
- **Negative-prompt baseline server-side enforced** — user mag toevoegen, niet weghalen.

## Hardware-realiteit

- RTX 4070, 12GB VRAM, i7-13700K, 32GB RAM, 438GB+ vrij disk
- CUDA 13.2, Docker met NVIDIA runtime, Node 24, Python 3.12
- Speed: ~52s per 1024px Flux-gen
- Tier-2 (candy.ai-equivalent) haalbaar; Tier-3 (Flux BF16, InfiniteYou, 24GB+) buiten scope

## Lumi-swap legacy folder

`C:\Users\Clips\repos\lumi-swap` bestaat fysiek nog (oude Claude-sessie was daar geanchored), maar is **deprecated**. De huidige sessie schreef alle wijzigingen via absolute paths naar luna/lumi — niets in lumi-swap. Verwijder het folder handmatig wanneer gewenst, en stop deze Claude-sessie zodat de CWD-binding loslaat.
