# Luna

A self-hosted, photorealistic AI person generator built with Angular 21 and ComfyUI (CUDA, Flux.1 dev).
Build a character once, then generate hundreds of consistent images across scenes, outfits and poses — locally, uncensored, no cloud, no API keys, no fees.

Sister project of [Lumi](../lumi/) (anime). Luna = realisme. Both share the `models/` folder via bind-mount.

## Quick start

```sh
# 1. Pull models (~22GB Fase-1 minimum)
node scripts/download-models.mjs

# 2. Boot ComfyUI on port 18190
docker compose -f infra/docker-compose.yml up -d

# 3. Install custom nodes
bash infra/install-nodes.sh

# 4. Boot frontend
cd apps/web && npm install && npm start
# → http://localhost:4200

# Or use Luna.bat to launch the dev stack with one click.
```

## Stack
- **Engine:** Flux.1 dev GGUF Q5_K_S (`city96/ComfyUI-GGUF`)
- **Identity:** PuLID-Flux v1.1 (no training)
- **Skin:** "Photorealistic Skin No Plastic" Flux-LoRA (always-on, weight 0.4–0.6)
- **NSFW finetune:** Jib Mix Flux v12 SRPO
- **Edit:** Flux.1 Kontext FP8 via NVIDIA TensorRT (RTX 40-serie)
- **Character-LoRA:** cloud (RunPod RTX 4090, ~$0.70/run)

See `CLAUDE.md` for the full architectuur, hard rules en agents-overzicht.
