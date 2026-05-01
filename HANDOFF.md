# Luna — Handoff (status & next session instructions)

Dit document beschrijft de **huidige bootstrap-status** van luna en geeft de **next steps** voor een verse Claude Code sessie. Lees dit eerst, dan `CLAUDE.md`, dan `.claude/plans/luna-bootstrap.md`.

## Voor de eerstvolgende Claude-sessie

1. **Open een nieuwe Claude Code sessie vanuit `C:\Users\Clips\repos\luna`** — dan wordt:
   - Memory automatisch geladen uit `C:\Users\Clips\.claude\projects\c--Users-Clips-repos-luna\memory\` (incl. fork-keuzes, quant-keuze, push-cadence, parallelism feedback)
   - Plan beschikbaar via `.claude/plans/luna-bootstrap.md`
   - Subagents werkend uit `.claude/agents/` (9 stuks)
   - Auto-approve voor alle file-edits onder `C:\Users\Clips\` actief via `.claude/settings.local.json`

2. **Zeg in de eerste prompt iets als**:
   > "Lees HANDOFF.md, CLAUDE.md, plan. Volgende stap: handmatig in ComfyUI op 18190 de eerste character-creation workflow bouwen met Flux Q5_K_S + Jib Mix + Skin LoRA + PuLID-Flux, dan exporteer als API-JSON naar `infra/workflows/character-creation.json`."

## Wat er staat — bootstrap is af (✅ klaar)

### Repo, infra, container
- `C:\Users\Clips\repos\luna` met git remote `https://github.com/Zyos-NL/Luna.git`
- `infra/docker-compose.yml`: `luna-comfyui` op port 18190, bind-mount `../../lumi/models`, named-volume `luna-comfyui-data`, NVIDIA GPU passthrough, CLI args `--reserve-vram 0.9 --use-pytorch-cross-attention --preview-method none`
- Container draait succesvol, ComfyUI 0.19.3, RTX 4070 herkent (12 GB VRAM)
- `infra/install-nodes.sh`: idempotent, installeert 5 custom nodes + facenet-pytorch dep:
  - `city96/ComfyUI-GGUF` (Flux GGUF loader)
  - `lldacing/ComfyUI_PuLID_Flux_ll` (identity-lock — actively maintained Flux fork; balazik/...-Enhanced bestaat niet, sipie800/...-Enhanced is discontinued)
  - `ltdrdata/ComfyUI-Impact-Pack` (FaceDetailer)
  - `Fannovel16/comfyui_controlnet_aux` (DWPose)
  - `Kosinkadink/ComfyUI-Advanced-ControlNet` (timing/weighting)
  - `facenet-pytorch` via `pip install --no-deps` (lldacing dep, omzeilt torch<2.3.0 pin)
- 8 PuLID-Flux node-classes geregistreerd in API: `ApplyPulidFlux`, `FixPulidFluxPatch`, `PulidFluxOptions`, `PulidFluxModelLoader`, `PulidFluxInsightFaceLoader`, `PulidFluxEvaClipLoader`, `PulidFluxFaceNetLoader`, `PulidFluxFaceDetector`
- `infra/.env.example` (template) + `infra/.env` (lokaal, gitignored, met CIVITAI_TOKEN)

### Models — Fase 1 minimum compleet (~28 GB op disk)
Alle 11 doelfiles aanwezig in `../lumi/models/`:
- `unet/flux1-dev-Q5_K_S.gguf` (7.8 GB) — **Q5_K_S, niet Q5_K_M** (city96 publiceert die niet)
- `clip/t5xxl_fp8_e4m3fn.safetensors` (4.6 GB)
- `clip/clip_l.safetensors` (235 MB, was al in lumi)
- `text_encoders/EVA02_CLIP_L_336_psz14_s6B.pt` (817 MB) — let op: **text_encoders/** folder (lldacing's `folder_paths.get_full_path("text_encoders", ...)`)
- `vae/ae.safetensors` (320 MB) — via Comfy-Org Lumina-2.0 mirror, BFL FLUX.1-dev is gated
- `pulid/pulid_flux_v0.9.1.safetensors` (1.1 GB)
- `loras/jibMixFlux_v12.safetensors` (12 GB)
- `loras/photorealisticSkinNoPlastic_flux.safetensors` (74 MB)
- `sams/sam_vit_b_01ec64.pth` (358 MB, was al in lumi)
- `ultralytics/segm/person_yolov8m-seg.pt` (53 MB, was al in lumi)
- `upscale_models/4x-UltraSharp.pth` (64 MB, was al in lumi)

### Scripts (`scripts/`)
- `download-models.mjs` (564 regels) — ESM Node 24, atomic .partial writes, --only/--list/--force flags, idempotente skip-check, always-skip lijst voor 5 shared lumi-files
- `verify-identity.mjs` — InsightFace ArcFace cosine-similarity via `docker exec luna-comfyui`, threshold 0.65/0.50, hostToContainer() helper voor de twee bind-mounts
- `verify-anatomy.mjs` — YOLO-pose keypoint count (yolo11n-pose, auto-download in container), 12/8 thresholds
- `screenshot.mjs` — kopie lumi pattern, native CDP via `ws`-package (lazy-imported), poort 18190

### Top-level + Angular skeleton
- `package.json` (top-level): name "luna", type "module", npm scripts voor download/verify-identity/verify-anatomy/screenshot. ws ^8.18.0 als devDep — **niet geïnstalleerd**
- `apps/web/` (26 files) — Angular 21.2.x + Material 21.2.7 standalone skeleton. Boilerplate gekopieerd uit lumi met luna-naming. Vier routes (`/characters` default, `/generate`, `/edit`, `/gallery`).
  - `core/comfy.service.ts` (port via `environment.comfyUrl=18190`)
  - `core/session.service.ts` (+ optional `characterId?: string`)
  - `core/character.service.ts` (candy.ai velden, localStorage `luna.characters`)
  - `core/workflow.service.ts` STUB met NEGATIVE_BASELINE constante (exact match CLAUDE.md hard rule #9), 4 builders die "not implemented" gooien
  - Feature-stubs voor alle 4 routes (snackbars als placeholders)
  - **`npm install` nog niet gedraaid** — user-actie wanneer eerste `ng serve` nodig

### Memory geborgd in `~/.claude/projects/c--Users-Clips-repos-luna/memory/`
- `feedback_tool_permissions.md` — Bash/PowerShell binnen luna-project pre-authorized
- `feedback_git_push_cadence.md` — Niet automatisch pushen na elke commit
- `feedback_max_parallelism.md` — Onafhankelijke tool calls altijd batchen
- `project_lumi_swap_deprecated.md` — lumi-swap-folder kan weg
- `project_pulid_flux_fork.md` — lldacing keuze + reasoning + node-class names
- `project_flux_quant_choice.md` — Q5_K_S keuze (Q5_K_M bestaat niet voor Flux dev)

### Git state
6 commits op main, **gepushed** tot `7fb8fc4` (Angular skeleton). 2 commits **lokaal** ahead:
- `836443a` scripts: switch fluxVae mirror — BFL FLUX.1-dev is gated (401)
- `27232b8` fix: switch Flux GGUF Q5_K_M -> Q5_K_S
Plus de HANDOFF-update die deze sessie afsluit.

## Wat er nog moet gebeuren (⏳ pending)

### 1. Workflows (`infra/workflows/`) — handmatig in ComfyUI bouwen
Geen agent kan dit zinvol scaffolden zonder live testing — de juiste node-graph ontstaat door iteratie in de UI.

- [ ] **Open ComfyUI op `http://localhost:18190`** (start container met `docker compose -f infra/docker-compose.yml up -d` als hij gestopt is)
- [ ] Bouw eerste **character-creation workflow**:
  - `UnetLoaderGGUF` → `unet/flux1-dev-Q5_K_S.gguf`
  - `DualCLIPLoader` → `t5xxl_fp8_e4m3fn.safetensors` + `clip_l.safetensors`
  - `VAELoader` → `vae/ae.safetensors`
  - `LoraLoader` chain: Jib Mix Flux v12 (strength 0.7) + Photorealistic Skin No Plastic (strength 0.5)
  - `KSampler` (steps=20, cfg=3.5, sampler=euler, scheduler=simple)
  - `VAEDecode` → `FaceDetailer` (Impact-Pack, sam_vit_b_01ec64, face_yolov8m, denoise 0.35) → `SaveImage` (`filename_prefix=characters/<id>/identity`)
  - **Negative prompt server-side enforced** — gebruik exact de string uit `apps/web/src/app/core/workflow.service.ts NEGATIVE_BASELINE`
  - Test met "young adult mediterranean woman, casual photo, kitchen morning light, white t-shirt"
  - Resultaat moet photoreal zijn, geen plastic skin, scherp gezicht
  - **Exporteer als API-format JSON** (Workflow → Save (API Format)) → opslaan als `infra/workflows/character-creation.json`
- [ ] Bouw **txt2img-character workflow** (daily driver) door PuLID-Flux nodes toe te voegen aan character-creation:
  - `PulidFluxModelLoader` → `pulid/pulid_flux_v0.9.1.safetensors`
  - `PulidFluxInsightFaceLoader` → `buffalo_l` (auto-download)
  - `PulidFluxEvaClipLoader` → `text_encoders/EVA02_CLIP_L_336_psz14_s6B.pt`
  - `ApplyPulidFlux` (weight=0.8, start=0.0, end=0.7, ref=identity.png)
  - `FixPulidFluxPatch` ná de toepassing (lldacing-specifieke fix tegen model-pollution)
  - Exporteer naar `infra/workflows/txt2img-character.json`
- [ ] Bouw **scene-variation workflow** (kopie van txt2img-character met PuLID weight=0.6, end=0.5) → `scene-variation.json`
- [ ] Bouw **face-detail-only workflow** (standalone FaceDetailer-pass) → `face-detail-only.json`
- [ ] **Fase 3 (later)**: Flux Kontext FP8 + TensorRT engine voor `character-edit.json` — vereist eerst `scripts/build-tensorrt.mjs` en download van `flux-kontext/flux1-kontext-dev-fp8.safetensors`

### 2. Frontend wire-up — workflow.service implementatie (Fase 2)
Nu de skeleton staat en de workflow JSON-templates komen, kan `apps/web/src/app/core/workflow.service.ts` ingevuld worden:

- [ ] `npm install` in `apps/web/` (eerste keer — installeert Angular 21 deps + ws)
- [ ] `buildCharacterCreation(params)`: laad `infra/workflows/character-creation.json` template, vervang prompt/seed/character-id velden, return als ComfyUI prompt
- [ ] `buildCharacterWorkflow(params)`: idem voor txt2img-character.json (+ identity.png path)
- [ ] `buildSceneVariation(params)`: idem voor scene-variation.json
- [ ] `buildCharacterEdit(params)`: idem voor character-edit.json (Fase 3)
- [ ] Wire `generate.ts` `onGenerate()` → `buildCharacterWorkflow()` → `comfy.queuePrompt()` → poll history → `session.appendImage()` met characterId tagging
- [ ] Wire `characters/character.dialog.ts` → form met candy.ai velden + `Create Identity` button die `buildCharacterCreation()` aanroept

### 3. Eerste end-to-end validatie
- [ ] `cd apps/web && npm install && npm start` → UI op 4200
- [ ] Maak character "Sofia" → klik **Create Identity** → portret in <60s, photoreal
- [ ] `node scripts/verify-identity.mjs --character sofia --output <path>` → cosine ≥0.65 op de output zelf (sanity, niet groot probleem als 1.0)
- [ ] Switch naar `/generate`, kies Sofia, prompt "kitchen morning, white t-shirt" → output in <60s, gezicht herkenbaar als Sofia (cosine ≥0.65 tegen identity.png)

### 4. Niet-blokkerende cleanup (lage prio)
- [ ] `.claude/settings.json` (untracked — stale `Bash(docker rm *)` permission, redundant naast settings.local.json) — verwijderen of negeren
- [ ] `C:\Users\Clips\repos\lumi-swap` legacy folder — fysiek opruimen wanneer gewenst (`Remove-Item -Recurse -Force`)

## Aanbevolen werkvolgorde voor de volgende sessie

**Sessie 2 (2-3 uur) — Workflow JSON's bouwen:**
1. Lees HANDOFF.md, CLAUDE.md, plan
2. Start container: `docker compose -f infra/docker-compose.yml up -d` (lumi-comfyui moet down zijn — `docker stop lumi-comfyui` als nodig)
3. Open `http://localhost:18190`
4. Bouw character-creation handmatig, test, exporteer → `infra/workflows/character-creation.json`
5. Spawn `character-pipeline` agent: review/refine de exported JSON, voeg meta-comments toe (welke node doet wat)
6. Bouw txt2img-character (PuLID erbij) → exporteer → `txt2img-character.json`
7. Idem scene-variation + face-detail-only

**Sessie 3 (3-4 uur) — Frontend wire-up:**
8. `npm install` in apps/web
9. Spawn `frontend` agent: vul `workflow.service.ts` in (4 builders), wire `generate.ts` + `character.dialog.ts`
10. End-to-end Sofia-flow test
11. Spawn `qa` agent: run `verify-identity.mjs` en `verify-anatomy.mjs` op output

**Sessie 4+:** Fase 3 (Flux Kontext + TensorRT engine + edit-route), Fase 4 (cloud-LoRA via RunPod).

## Belangrijke pointers (cheat sheet)

- **ComfyUI port: 18190.** Lumi = 18188. Niet 18189 (lumi-swap bestaat niet meer).
- **Models bind-mount uit `../lumi/models/`** — luna mag toevoegen, **nooit** overschrijven.
- **Engine: Flux.1 dev GGUF Q5_K_S** via `city96/ComfyUI-GGUF`. **Q5_K_M bestaat niet voor Flux dev** in die repo.
- **Identity: PuLID-Flux v0.9.1 via `lldacing/ComfyUI_PuLID_Flux_ll`** (lldacing fork — balazik-Enhanced bestaat niet, sipie800-Enhanced is discontinued, cubiq is SDXL-only).
- **Skin-LoRA always-on** op weight 0.4–0.6 (kwaliteitsfloor, niet user-disableable).
- **T5 encoder: `t5xxl_fp8_e4m3fn.safetensors`** — NIET T5 Q5_K_M GGUF (OOM op 12GB i.c.m. FP8/GGUF Flux UNet).
- **VAE bron**: `Comfy-Org/Lumina_Image_2.0_Repackaged` mirror (BFL FLUX.1-dev is gated).
- **Character-LoRA training: cloud RunPod** (~$0.70/run). Lokale Flux-LoRA training niet doen.
- **GPU-mutex**: lumi en luna kunnen niet tegelijk draaien (12GB VRAM). Stop lumi voor je luna start.
- **VRAM-budget**: peak ~10.5–11.5GB. batch_size=1 verplicht.
- **Identity-cosine threshold: ≥0.65** (PuLID levert hoger dan SDXL+IPAdapter).
- **NSFW ongecensureerd** — geen prompt-rewriting, geen safety-filters.
- **Negative-prompt baseline server-side enforced** in `workflow.service.ts NEGATIVE_BASELINE` — user mag toevoegen, niet weghalen.

## Hardware-realiteit

- RTX 4070, 12GB VRAM, i7-13700K, 32GB RAM, ~410GB+ vrij disk (na Fase-1 download)
- CUDA 13.2, Docker met NVIDIA runtime, Node 24, Python 3.12 (host) / 3.13.13 (container)
- Speed: ~52s per 1024px Flux-gen (geschat, eerste Sofia-gen valideert dit)
- Tier-2 (candy.ai-equivalent) haalbaar; Tier-3 (Flux BF16, InfiniteYou, 24GB+) buiten scope
