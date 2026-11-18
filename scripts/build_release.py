"""Build an allowlisted web/backend release with explicit portable permissions."""
import argparse
import hashlib
import json
import re
import tarfile
from pathlib import Path


def build(tag):
    root = Path(__file__).resolve().parents[1]
    files = set()
    for folder in ("app", "migrations", "frontend/src", "frontend/public"):
        for path in (root / folder).rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts and path.suffix not in (".pyc", ".pyo"):
                files.add(path.relative_to(root))
    for name in ("Dockerfile", ".dockerignore", "requirements.txt", "alembic.ini", "compose.production.yaml",
                 "frontend/Dockerfile", "frontend/.dockerignore", "frontend/package.json", "frontend/pnpm-lock.yaml",
                 "frontend/index.html", "frontend/nginx.conf", "deploy/Caddyfile", "deploy/frontend.conf",
                 "deploy/backup.sh", "deploy/lifehub-backup.service", "deploy/lifehub-backup.timer"):
        files.add(Path(name))
    for pattern in ("tsconfig*.json", "vite.config.*", "vitest.config.*"):
        files.update(p.relative_to(root) for p in (root / "frontend").glob(pattern))
    directories = {p for file in files for p in file.parents if p != Path(".")}
    output = root / "output/releases"
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"lifehub-{tag}-web-backend.tar.gz"
    def permissions(info):
        info.mode = 0o755 if info.isdir() else 0o644
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        return info
    with tarfile.open(archive, "w:gz") as tar:
        for directory in sorted(directories, key=lambda p: (len(p.parts), str(p))):
            tar.add(root / directory, arcname=directory.as_posix(), recursive=False, filter=permissions)
        for file in sorted(files):
            tar.add(root / file, arcname=file.as_posix(), recursive=False, filter=permissions)
    manifest = dict(archive=archive.name, sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
                    files=len(files), directories=len(directories), bytes=archive.stat().st_size, status="prepared")
    (output / f"lifehub-{tag}-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("tag")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]{8}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?", args.tag):
        parser.error("Use YYYYMMDD or YYYYMMDD-label")
    build(args.tag)
