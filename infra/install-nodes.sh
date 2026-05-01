#!/usr/bin/env bash
#
# install-nodes.sh — install Luna's ComfyUI custom nodes inside the luna-comfyui container.
#
# Idempotent: re-running is safe. Already-cloned repos are skipped (no overwrite),
# pip install is re-run so requirement updates are applied.
#
# Run from the host (not inside the container). Requires `docker` on PATH and the
# luna-comfyui container to be running:
#
#     docker compose -f infra/docker-compose.yml up -d
#     bash infra/install-nodes.sh
#
set -euo pipefail

CONTAINER="luna-comfyui"
NODES_DIR="/root/ComfyUI/custom_nodes"

# Verify the container is up before we start exec-ing.
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: container '${CONTAINER}' is not running."
  echo "       Start it first: docker compose -f infra/docker-compose.yml up -d"
  exit 1
fi

# install_node <repo-folder-name> <git-url>
# Clones into $NODES_DIR/<folder> if not already present, then pip-installs requirements.txt
# if that file exists. All work happens inside the container via docker exec.
install_node() {
  local name="$1"
  local url="$2"

  echo
  echo "=== ${name} ==="

  docker exec "${CONTAINER}" bash -c "
    set -euo pipefail
    cd '${NODES_DIR}'
    if [ -d '${name}/.git' ]; then
      echo '  [skip clone] ${name} already cloned'
    else
      echo '  [clone] ${url}'
      git clone --depth 1 '${url}' '${name}'
    fi
    if [ -f '${name}/requirements.txt' ]; then
      echo '  [pip] installing requirements.txt'
      pip install --no-cache-dir -r '${name}/requirements.txt'
    else
      echo '  [pip] no requirements.txt — skipping'
    fi
  "
}

# Order matters: dependencies first.
#  1. ComfyUI-GGUF       → Flux GGUF loader (Q5_K_S is Luna's daily driver)
#  2. PuLID_Flux_ll      → identity-lock (lldacing fork; vereist insightface + facexlib + facenet-pytorch)
#  3. Impact-Pack        → FaceDetailer node (laatste pass voor close-ups)
#  4. controlnet_aux     → DWPose preprocessor (SDXL pose-fallback)
#  5. Advanced-ControlNet → controlnet timing/weighting
install_node "ComfyUI-GGUF"                   "https://github.com/city96/ComfyUI-GGUF"
install_node "ComfyUI_PuLID_Flux_ll"          "https://github.com/lldacing/ComfyUI_PuLID_Flux_ll"
install_node "ComfyUI-Impact-Pack"            "https://github.com/ltdrdata/ComfyUI-Impact-Pack"
install_node "ComfyUI-Impact-Subpack"         "https://github.com/ltdrdata/ComfyUI-Impact-Subpack"
install_node "comfyui_controlnet_aux"         "https://github.com/Fannovel16/comfyui_controlnet_aux"
install_node "ComfyUI-Advanced-ControlNet"    "https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet"

# lldacing's requirements.txt heeft facenet-pytorch uitgecomment omdat het torch<2.3.0 pint.
# Wij draaien torch 2.11.0+cu130 — install met --no-deps zodat de torch-pin genegeerd wordt.
# Zonder deze module faalt de import van pulidflux.py met ModuleNotFoundError.
echo
echo "=== facenet-pytorch (lldacing runtime dep, --no-deps) ==="
docker exec "${CONTAINER}" bash -c "
  set -euo pipefail
  if pip show facenet-pytorch >/dev/null 2>&1; then
    echo '  [skip] facenet-pytorch already installed'
  else
    pip install --no-cache-dir --no-deps facenet-pytorch
  fi
"

# ComfyUI 0.19.3 compat patch: lldacing's pulid_forward_orig() signature mist
# **kwargs en crasht op het nieuwe `timestep_zero_index=` keyword dat ComfyUI's
# core forward-call meegeeft. Geüpstreamd door ons patch-block hieronder. Zodra
# lldacing dit upstream fixt, kan dit blok weg.
# Idempotent: skip als **kwargs al aanwezig is in de signature.
echo
echo "=== ComfyUI 0.19.3 compat patch voor lldacing PulidFluxHook.py ==="
docker exec "${CONTAINER}" python3 - <<'PYEOF'
import re, sys
p = '/root/ComfyUI/custom_nodes/ComfyUI_PuLID_Flux_ll/PulidFluxHook.py'
try:
    src = open(p).read()
except FileNotFoundError:
    print(f'  [skip] {p} does not exist (PuLID-Flux node not installed?)')
    sys.exit(0)

# Locate the pulid_forward_orig() signature block.
sig_re = re.compile(
    r'(def pulid_forward_orig\([^)]*?attn_mask: Tensor = None,)(\s*\) -> Tensor:)',
    re.DOTALL,
)
m = sig_re.search(src)
if not m:
    # Already patched if **kwargs is present in the signature block.
    parts = src.split('def pulid_forward_orig', 1)
    if len(parts) == 2 and '**kwargs' in parts[1].split(') -> Tensor:', 1)[0]:
        print('  [skip] PulidFluxHook.py already patched (**kwargs present)')
        sys.exit(0)
    print('  [error] pulid_forward_orig signature not found — lldacing may have refactored. Check upstream.')
    sys.exit(1)

new = src[:m.end(1)] + '\n    **kwargs,' + src[m.start(2):]
open(p, 'w').write(new)
print('  [patch] PulidFluxHook.py: added **kwargs to pulid_forward_orig signature')
PYEOF

# TODO: Flux Kontext TensorRT node — researcher agent moet repo bevestigen voor Fase 3.
#       Niet clonen tot de juiste repo + node-naam vaststaat (er zijn meerdere forks in omloop).

echo
echo "Done. Restart luna-comfyui: docker compose -f infra/docker-compose.yml restart"
