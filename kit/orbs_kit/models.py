"""The kit's model files: fetched from where they are published, verified by hash (PLAN 1.3).

They are too big for git (350 MB), so a fresh kit has none until this runs. Each file is
downloaded from its upstream release, written beside the carried modules (kit/ash/models, where
voice.py and turnend.py look), and kept only if its sha256 is the one pinned here — a truncated
or substituted file is deleted, never used. `--from DIR` takes files from a local folder instead
(for example an existing Ash install), with the same hash check, so nothing unverified gets in
either way.

    uv run --project kit --locked python -m orbs_kit.models            # fetch what is missing
    uv run --project kit --locked python -m orbs_kit.models --from DIR
    uv run --project kit --locked python -m orbs_kit.models --check    # exit 1 if any is missing or wrong
"""
from __future__ import annotations

import hashlib
import shutil
import sys
import urllib.request
from pathlib import Path

DEST = Path(__file__).resolve().parent.parent / "ash" / "models"

# (file, url, sha256, bytes, what it is)
MODELS = [
    ("kokoro-v1.0.onnx",
     "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
     "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5", 325_532_387,
     "Kokoro 82M, the voice (Apache-2.0)"),
    ("voices-v1.0.bin",
     "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
     "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d", 28_214_398,
     "Kokoro's voice styles, the blends' ingredients"),
    ("smart-turn-v3.2-cpu.onnx",
     "https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx",
     "2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f", 8_679_182,
     "Smart Turn v3.2, when a person has finished speaking (BSD-2)"),
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def missing(dest: Path = DEST) -> list[str]:
    """Files absent or not the pinned bytes."""
    out = []
    for name, _, digest, size, _ in MODELS:
        p = dest / name
        if not p.is_file() or p.stat().st_size != size or sha256(p) != digest:
            out.append(name)
    return out


def fetch(dest: Path = DEST, source: Path | None = None, log=print) -> list[str]:
    """Brings every missing model in, verified. Returns the names that could not be fetched."""
    dest.mkdir(parents=True, exist_ok=True)
    failed = []
    for name, url, digest, size, what in MODELS:
        if name not in missing(dest):
            continue
        part = dest / f"{name}.part"
        part.unlink(missing_ok=True)
        try:
            if source is not None:
                shutil.copyfile(source / name, part)
                how = f"copied from {source}"
            else:
                log(f"downloading {name} ({size / 1e6:.0f} MB): {what}")
                with urllib.request.urlopen(url, timeout=60) as r, part.open("wb") as f:
                    shutil.copyfileobj(r, f, 1 << 20)
                how = "downloaded"
            got = sha256(part)
            if got != digest:
                raise ValueError(f"sha256 {got[:12]}… is not the pinned {digest[:12]}…")
            part.replace(dest / name)
            log(f"{name}: {how}, verified")
        except Exception as e:  # noqa: BLE001 - reported per file, the rest still fetched
            part.unlink(missing_ok=True)
            log(f"{name}: NOT fetched — {e}")
            failed.append(name)
    return failed


def main(argv: list[str]) -> int:
    if "--check" in argv:
        bad = missing()
        for n in bad:
            print(f"missing or wrong: {n}")
        return 1 if bad else 0
    source = Path(argv[argv.index("--from") + 1]).expanduser() if "--from" in argv else None
    failed = fetch(source=source)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
