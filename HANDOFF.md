# Luna — Handoff (status & next session instructions)

Dit document beschrijft de **huidige bootstrap-status** van luna en geeft de **next steps** voor een verse Claude Code sessie. Lees dit eerst, dan `CLAUDE.md`, dan `.claude/plans/luna-bootstrap.md`.

## Voor de eerstvolgende Claude-sessie

1. **Open een nieuwe Claude Code sessie vanuit `C:\Users\Clips\repos\luna`** — dan worden:
   - Memory automatisch geladen uit `C:\Users\Clips\.claude\projects\c--Users-Clips-repos-luna\memory\`
   - Plan beschikbaar via `.claude/plans/luna-bootstrap.md`
   - Subagents werkend uit `.claude/agents/` (9 stuks)
   - Auto-approve voor alle file-edits + bash + powershell onder `C:\Users\Clips\` actief via `.claude/settings.local.json`

2. **Zeg in de eerste prompt iets als**:
   > "Lees HANDOFF.md, CLAUDE.md, plan. Volgende stap is Fase 3 (Flux Kontext + TensorRT engine voor /edit route) — of een van de kleine polish-items uit de pending-lijst."

## Wat er staat — Fase 1 + Fase 2 zijn af (✅ klaar)

### Container, custom nodes, models
- `luna-comfyui` op port 18190, recreated met `--cpu-vae` flag (voorkomt VAEDecode CUDA-crash)
- 6 custom nodes geïnstalleerd:
  - `city96/ComfyUI-GGUF` (Flux GGUF loader)
  - `lldacing/ComfyUI_PuLID_Flux_ll` (identity-lock — ComfyUI 0.19.3 patch in install-nodes.sh applied for `pulid_forward_orig` `**kwargs` signature)
  - `ltdrdata/ComfyUI-Impact-Pack` (FaceDetailer)
  - `ltdrdata/ComfyUI-Impact-Subpack` (UltralyticsDetectorProvider — split out van Impact-Pack)
  - `Fannovel16/comfyui_controlnet_aux` (DWPose, voor SDXL fallback)
  - `Kosinkadink/ComfyUI-Advanced-ControlNet` (timing/weighting)
  - Plus `facenet-pytorch` als pip-dep voor lldacing
- 8 PuLID-Flux node-classes geregistreerd: `ApplyPulidFlux`, `FixPulidFluxPatch`, `PulidFluxOptions`, `PulidFluxModelLoader`, `PulidFluxInsightFaceLoader`, `PulidFluxEvaClipLoader`, `PulidFluxFaceNetLoader`, `PulidFluxFaceDetector`. (FixPulidFluxPatch wordt **niet** gebruikt in workflows — incompatibel met ComfyUI 0.19.3 zonder de runtime-patch; single-shot workflows zijn veilig zonder.)

### Models — ~28 GB op disk in `../lumi/models/`
Alle 11 Fase-1 doelfiles aanwezig:
- `unet/flux1-dev-Q5_K_S.gguf` (7.8 GB) — Q5_K_S, niet Q5_K_M
- `clip/t5xxl_fp8_e4m3fn.safetensors` (4.6 GB) — FP8, niet GGUF
- `clip/clip_l.safetensors` (235 MB)
- `text_encoders/EVA02_CLIP_L_336_psz14_s6B.pt` (817 MB) — let op `text_encoders/`, niet `clip/`
- `vae/ae.safetensors` (320 MB) — via Comfy-Org Lumina-2.0 mirror, BFL is gated
- `pulid/pulid_flux_v0.9.1.safetensors` (1.1 GB)
- `loras/jibMixFlux_v12.safetensors` (12 GB)
- `loras/photorealisticSkinNoPlastic_flux.safetensors` (74 MB)
- `sams/sam_vit_b_01ec64.pth` (358 MB)
- `ultralytics/segm/person_yolov8m-seg.pt` (53 MB)
- `upscale_models/4x-UltraSharp.pth` (64 MB)

### ComfyUI workflow JSONs — `infra/workflows/` (4 stuks, 3 API-validated)
- `character-creation.json` (16 nodes) — Flux + Jib Mix(0.7) + Skin(0.5) + KSampler + FaceDetailer + SaveImage. **Validated**: identity_00001_.png photoreal Mediterranean woman, candy.ai-tier.
- `txt2img-character.json` (21 nodes) — character-creation + PuLID-Flux weight=0.8 end_at=0.7 + LoadImage(identity). **Validated**: scene_kitchen identity-preserved.
- `scene-variation.json` (21 nodes) — PuLID weight=0.6 end_at=0.5 voor meer scene-ruimte. **Validated**: scene_park_lowweight.
- `face-detail-only.json` (13 nodes) — standalone repair-pass met mini Flux-stack zonder Jib Mix/PuLID. JSON-syntactisch valid, niet API-tested (geen test-input image).

### Frontend (Angular 21 + Material 21, dark M3) — Sofia-flow end-to-end clickable
- 4 routes: `/characters` (default), `/generate`, `/edit` (Fase 3 placeholder), `/gallery`
- Core services geïmplementeerd:
  - `comfy.service.ts`: queuePrompt, waitForResult (met error-detection + execution_error extractie), uploadImage, history, WS progress
  - `character.service.ts`: candy.ai velden, localStorage `luna.characters`, hasIdentity guard, upsertDraft
  - `session.service.ts`: + characterId tagging op SessionImage
  - `workflow.service.ts`: 4 builders → BuildResult ({wf, seed}). Resolved seed echo-back voor reproducible re-rolls
  - `prompt-compose.ts`: pure helpers composeCharacterTraits / composeIdentityPrompt / composeScenePrompt
- Templates als TS-modules (`core/workflows/*.template.ts`) — typed, deep-cloned, geen runtime fetch
- Feature components wired:
  - `characters/character.dialog.ts`: form + Create Identity flow + identity-portrait preview
  - `characters/characters.ts`: grid met identity-thumbnails + dialog launch
  - `generate/generate.ts`: character-picker + scene/outfit/pose/shot/mood form + dimensions preset (1024×1024 / 832×1216 / 768×1344) + seed input + NSFW toggle + Generate flow (output→input round-trip → uploadImage → buildCharacterWorkflow|buildSceneVariation → queue → waitForResult → SessionService.appendImage met characterId)
  - `gallery/gallery.ts`: filter dropdown per character
  - `edit/edit.ts`: placeholder voor Fase 3
- NSFW toggle: default off → blokkeert "nude, undressed, naked, explicit" via negative-prompt-extra. On → no extra restriction (Jib Mix is NSFW-finetuned, user-prompt stuurt). Tooltip "Off: blokkeert nudity. On: ondeugend mag."
- top-level `package.json` + `package-lock.json` met `ws` voor screenshot.mjs CDP-client

### Scripts (`scripts/`)
- `download-models.mjs` — ESM Node 24, idempotent skip, --only / --list / --force flags, always-skip lijst voor 5 shared lumi-files
- `verify-identity.mjs` — InsightFace ArcFace cosine-sim via `docker exec luna-comfyui`, threshold 0.65/0.50
- `verify-anatomy.mjs` — YOLO-pose keypoint count (yolo11n-pose), 12/8 thresholds
- `screenshot.mjs` — kopie lumi pattern, native CDP via `ws`, port 18190

### Memory geborgd in `~/.claude/projects/c--Users-Clips-repos-luna/memory/`
- `feedback_tool_permissions.md` — Bash/PowerShell/Edit auto-approve
- `feedback_git_push_cadence.md` — niet automatisch pushen na elke commit
- `feedback_max_parallelism.md` — onafhankelijke tool calls altijd batchen
- `project_lumi_swap_deprecated.md` — lumi-swap is weg
- `project_pulid_flux_fork.md` — lldacing keuze + node-class names + FixPulidFluxPatch disabled note
- `project_flux_quant_choice.md` — Q5_K_S keuze (Q5_K_M bestaat niet voor Flux dev)

## Wat er nog moet gebeuren (⏳ pending)

### Klein / UX (≤30 min elk, oppakbaar wanneer er tijd is)
- [ ] Gallery image-modal: klik thumbnail → full-size modal met meta (prompt, seed, character-naam)
- [ ] `personalityTags` daadwerkelijk in scene-prompt injecteren — momenteel persisted in `Character` maar niet gebruikt in `composeScenePrompt`. Watch voor over-conditioning.
- [ ] `onnxruntime-gpu` in container voor InsightFace GPU-accel (huidige fallback is CPU = +1-2s per gen). Toe te voegen via `pip install onnxruntime-gpu` + extra `install-nodes.sh` step.
- [ ] Hand-detector pass voor body-gens via Impact-Pack `hand_yolov8s` (tweede FaceDetailer-achtige pass specifiek op handen). Verbetert hand-quality op full-body shots.
- [ ] Gen progress bar: huidige polling via WS `progress$` toont alleen sampler-step. KSampler is ~70% van de tijd, daarna VAEDecode + FaceDetailer (+10s) — niet zichtbaar in progress.

### Fase 3 — `/edit` route met Flux Kontext (eigen sessie, ~4-6 uur)
Hard dep: Fase-1 + Fase-2 stable identity-output (✓ done).

- [ ] Download `flux-kontext/flux1-kontext-dev-fp8.safetensors` (~12 GB, gated op BFL — mogelijk mirror nodig zoals VAE)
- [ ] `scripts/build-tensorrt.mjs` — one-time TensorRT engine compile in container (~30 min, RTX 40-serie specifiek). Engine = `tensorrt/flux-kontext-rtx40.engine` (~8 GB)
- [ ] ComfyUI-FluxKontext custom node clonen (researcher agent moet juiste repo bevestigen — `infra/install-nodes.sh` heeft al een TODO comment hiervoor)
- [ ] `infra/workflows/character-edit.json` — Flux Kontext FP8 + TensorRT engine + identity.png + edit-prompt → output
- [ ] `apps/web/src/app/features/edit/edit.ts` — kies character + bestaand image + edit-prompt UI
- [ ] `WorkflowService.buildCharacterEdit()` implementeren (momenteel throws "Fase 3 not implemented")

### Fase 4 — Cloud-LoRA training (eigen sessie, ~3-4 uur)
Hard dep: Fase-2 + ≥30 accepted gens per character + RunPod API-key.

- [ ] `scripts/train-lora-cloud.mjs` — RunPod-API call (spin RTX 4090 pod, push dataset, run kohya/ai-toolkit Flux-LoRA, pull result)
- [ ] Auto-dataset-builder UI: select ≥30 favorites uit gallery → captioner (BLIP-3 / Florence-2) → trigger training
- [ ] `training/config/` met kohya/ai-toolkit Flux-LoRA configs
- [ ] LoRA-merge in workflow vóór PuLID-stack: LoRA strength 0.6 + PuLID 0.45 (lower omdat LoRA totale identity pakt)
- [ ] Kosten-estimate UI: ~$0.50–0.70 per character-LoRA, 60-90 min duration

### Fase 5 (backlog — alleen als Fase-2 quality onvoldoende blijkt)
- [ ] SDXL pose-controlled fallback (alleen als Flux ControlNet ecosystem te beperkt blijkt voor specifieke poses)
- [ ] ReActor face-swap post-pass (alleen als PuLID-Flux identity-fail-rate >10%)
- [ ] Fluxed Up v10 als alt checkpoint (Civitai 847101)

### Niet-blokkerende cleanup (lage prio)
- [ ] `.claude/settings.json` (untracked, stale `Bash(docker rm *)` permission — redundant naast settings.local.json) → verwijderen of negeren
- [ ] `C:\Users\Clips\repos\lumi-swap` legacy folder — fysiek opruimen (`Remove-Item -Recurse -Force`)

## Belangrijke pointers (cheat sheet)

- **ComfyUI port: 18190.** Lumi = 18188.
- **GPU-mutex:** lumi en luna kunnen niet tegelijk draaien (12GB VRAM).
- **Models bind-mount uit `../lumi/models/`** — luna mag toevoegen, **nooit** overschrijven.
- **Engine: Flux.1 dev GGUF Q5_K_S** via `city96/ComfyUI-GGUF`. Q5_K_M bestaat niet voor Flux dev in die repo.
- **Identity: PuLID-Flux v0.9.1 via `lldacing/ComfyUI_PuLID_Flux_ll`** + container-runtime patch op `pulid_forward_orig` (in install-nodes.sh).
- **VAE op CPU** (`--cpu-vae`) op 12GB om VAEDecode `cudaErrorInvalidValue` te voorkomen na KSampler model-unload.
- **Skin-LoRA always-on** op weight 0.4–0.6 (kwaliteitsfloor).
- **T5 encoder: `t5xxl_fp8_e4m3fn.safetensors`** — NIET T5 Q5_K_M GGUF (OOM op 12GB i.c.m. FP8/GGUF Flux UNet).
- **VAE bron**: `Comfy-Org/Lumina_Image_2.0_Repackaged` mirror (BFL FLUX.1-dev is gated).
- **Character-LoRA training: cloud RunPod** (~$0.70/run). Lokale Flux-LoRA training niet doen.
- **VRAM peak ~10.5–11.5GB.** batch_size=1 verplicht.
- **Identity-cosine threshold: ≥0.65** (PuLID levert hoger dan SDXL+IPAdapter).
- **NSFW ongecensureerd** — toggle off blokkeert nudity via negative-prompt-extra; on doet niks.
- **Negative-prompt baseline server-side enforced** in `workflow.service.ts NEGATIVE_BASELINE`.

## Hardware-realiteit

- RTX 4070, 12GB VRAM, i7-13700K, 32GB RAM, ~410GB+ vrij disk
- CUDA 13.2, Docker met NVIDIA runtime, Node 24, Python 3.12 (host) / 3.13.13 (container)
- Speed: Flux Q5_K_S + PuLID + FaceDetailer = ~60-90s eerste run (model-load), ~52-60s subsequent
- VAE op CPU: +3-5s per gen, in ruil voor stabiliteit
- Tier-2 (candy.ai-equivalent) bewezen haalbaar; Tier-3 (Flux BF16, InfiniteYou, 24GB+) buiten scope
