# Model Weight SHA Pinning

> **Purpose** — record SHA256 of downloaded ML model weights so we can detect
> upstream weight tampering / unintended model swaps. Driven by M1C-B closeout
> gate item (ADR-012 amendment 2026-05-10).

## How it works

vessel-core anchors `@huggingface/transformers` cache to `$VESSEL_DATA_DIR/models/`
(default `~/.vessel/models/`) — set in `embedder.ts` at module load via
`transformersEnv.cacheDir`. This is independent of `node_modules`, so
`pnpm install` won't blow away the 90MB ONNX model.

Operators can override with `HF_HOME` env var (transformers.js respects it).

On first model use the file is downloaded from `huggingface.co`. **HF CDN serves
HTTPS + ETag but does not GPG-sign weights.** This file pins the SHA256 of
expected weight files.

`vessel-core memory status` is **advisory only** — does not currently abort if
SHA mismatches; surface as warning. M1C-B+ defer item: enforced check.

## Currently pinned models

### Xenova/bge-small-zh-v1.5 (per ADR-012 amendment)

| File | Expected SHA256 | Size | Source |
|---|---|---|---|
| `onnx/model.onnx` | `69a0b846f4f116b5e6aabf9546ea6754d02264f3211a13a1bd69b31b8040749a` | ~90 MB | [huggingface.co/Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5) |

**Pinned on**: 2026-05-10 (M1C-B closeout, after first e2e test download)
**Cache location since 2026-05-11**: `$VESSEL_DATA_DIR/models/Xenova/bge-small-zh-v1.5/onnx/model.onnx`

## Verification command

```bash
expected_sha="69a0b846f4f116b5e6aabf9546ea6754d02264f3211a13a1bd69b31b8040749a"
cache_path="${VESSEL_DATA_DIR:-$HOME/.vessel}/models/Xenova/bge-small-zh-v1.5/onnx/model.onnx"
actual=$(shasum -a 256 "$cache_path" | cut -d' ' -f1)
[ "$expected_sha" = "$actual" ] && echo "OK" || { echo "MISMATCH"; exit 1; }
```

> Older Vessel installs (pre-2026-05-11) cached under `node_modules/.pnpm/@huggingface+transformers@*/node_modules/@huggingface/transformers/.cache/`.
> First post-upgrade run triggers a one-time redownload to the new location;
> the old cache is safe to `rm -rf` after upgrade.

## Future automation (M1C-B+ defer)

- `vessel-core memory verify-sha` subcommand — compare current ~/.cache against
  this file
- Optional `--strict` mode that aborts startup on mismatch
- Embedded SHA constants in TS code so this file becomes a documentation
  reference rather than the source of truth

## Out of scope (rejected as YAGNI)

- GPG signing the weights ourselves — too much operator burden
- Fetching from HF with `Accept: application/vnd.git-lfs+json` to get
  Git LFS pointer SHA — adds complexity for minimal supply chain gain over
  the file-content SHA above
