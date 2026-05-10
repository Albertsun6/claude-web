# Model Weight SHA Pinning

> **Purpose** — record SHA256 of downloaded ML model weights so we can detect
> upstream weight tampering / unintended model swaps. Driven by M1C-B closeout
> gate item (ADR-012 amendment 2026-05-10).

## How it works

`@huggingface/transformers` v4 caches downloaded ONNX models under
`<repo-root>/node_modules/.pnpm/@huggingface+transformers@*/node_modules/@huggingface/transformers/.cache/`
(per-package install, not under `~/.cache/huggingface/` like the Python lib).
On first use of a model, the file is downloaded from `huggingface.co`.
**HF CDN serves with HTTPS + ETag but does not GPG-sign weights.**

This file pins the SHA256 of expected weight files. `vessel-core memory status`
**advisory only** — does not currently abort if SHA mismatches; surface as
warning. M1C-B closeout MINOR-2: upgrade to enforced check in M1C-B+ once we
have stable production usage.

## Currently pinned models

### Xenova/bge-small-zh-v1.5 (per ADR-012 amendment)

| File | Expected SHA256 | Size | Source |
|---|---|---|---|
| `onnx/model.onnx` | `69a0b846f4f116b5e6aabf9546ea6754d02264f3211a13a1bd69b31b8040749a` | ~90 MB | [huggingface.co/Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5) |

**Pinned on**: 2026-05-10 (M1C-B closeout, after first e2e test download)

## Verification command

```bash
# Replace <pkg-version> with your installed @huggingface/transformers version
expected_sha="69a0b846f4f116b5e6aabf9546ea6754d02264f3211a13a1bd69b31b8040749a"
cache_path="node_modules/.pnpm/@huggingface+transformers@4.2.0/node_modules/@huggingface/transformers/.cache/Xenova/bge-small-zh-v1.5/onnx/model.onnx"
actual=$(shasum -a 256 "$cache_path" | cut -d' ' -f1)
[ "$expected_sha" = "$actual" ] && echo "OK" || { echo "MISMATCH"; exit 1; }
```

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
