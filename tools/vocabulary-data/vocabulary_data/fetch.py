"""Explicit source acquisition and verification.

Downloading only happens through `fetch`; a pipeline run never touches the
network. Files land in raw/<source-id>/, are checked against the sha256 pinned
in the source register, and are never overwritten: an existing file is only
verified, and a mismatch is an error for a human to look at.
"""

from __future__ import annotations

import importlib.metadata
import importlib.util
import os
import tempfile
import urllib.request
from pathlib import Path
from typing import Any

from .manifest import ManifestError, SourceRegister, sha256_file

# Generic client name: no personal or project details are sent to external services.
USER_AGENT = "vocabulary-data-pipeline/0.1"


class SourceError(RuntimeError):
    """A source is missing, modified or not installed as pinned."""


def source_dir(raw_dir: Path, source_id: str) -> Path:
    return raw_dir / source_id


def fetch_source(register: SourceRegister, source_id: str, raw_dir: Path, *, opener=urllib.request.urlopen) -> list[str]:
    """Downloads the pinned files of one source; returns a line per file describing what happened."""
    source = register.usable(source_id)
    if source["kind"] == "python-package":
        package = source["package"]
        return [f"{source_id}: installed as a Python package; run `python -m pip install -r {package['requirements_file']}` in the pipeline environment, then `check-sources`."]
    if source["kind"] == "built-database":
        build = source["build"]
        # Building runs the upstream project's own code: a person does it, following the README, never this command.
        return [
            f"{source_id}: built locally, never downloaded by this tool. Clone {build['repository']} at tag {build['tag']} "
            f"(commit {build['commit']}) with core.autocrlf=false, copy combine.py, libscowl/ and data/ into a fresh folder, run "
            f"`{build['command']}` there, and copy {source['database']['name']} to raw/{source_id}/. See README §4."
        ]
    target = source_dir(raw_dir, source_id)
    target.mkdir(parents=True, exist_ok=True)
    report: list[str] = []
    for item in source["files"]:
        path = target / item["name"]
        if path.exists():
            actual = sha256_file(path)
            if actual != item["sha256"]:
                raise SourceError(f"{source_id}/{item['name']} exists but its sha256 is {actual}, not the pinned {item['sha256']}. It was not overwritten; inspect or remove it by hand.")
            report.append(f"{source_id}/{item['name']}: already present, sha256 verified.")
            continue
        request = urllib.request.Request(item["url"], headers={"User-Agent": USER_AGENT})
        handle, temporary = tempfile.mkstemp(dir=target, prefix=".download-")
        try:
            with os.fdopen(handle, "wb") as out, opener(request, timeout=120) as response:
                while block := response.read(1 << 20):
                    out.write(block)
            actual = sha256_file(Path(temporary))
            if actual != item["sha256"]:
                raise SourceError(f"{source_id}/{item['name']}: downloaded sha256 {actual} does not match the pinned {item['sha256']}. Nothing was saved.")
            os.replace(temporary, path)
            report.append(f"{source_id}/{item['name']}: downloaded and verified ({path.stat().st_size} bytes).")
        finally:
            if os.path.exists(temporary):
                os.remove(temporary)
    return report


def package_data_path(package: dict[str, Any]) -> Path:
    """The installed data file of a pinned package source (e.g. wordfreq's large_en.msgpack.gz)."""
    name = package["name"]
    if importlib.util.find_spec(name) is None:
        raise SourceError(f"Python package '{name}' is not installed. Run `python -m pip install -r {package['requirements_file']}` in the pipeline environment.")
    installed = importlib.metadata.version(name)
    if installed != package["version"]:
        raise SourceError(f"'{name}' {installed} is installed, but the register pins {package['version']}.")
    distribution = importlib.metadata.distribution(name)
    path = Path(str(distribution.locate_file(package["data_file"])))
    if not path.exists():
        raise SourceError(f"'{name}' is installed but {package['data_file']} is missing.")
    return path


def verify_source(register: SourceRegister, source_id: str, raw_dir: Path) -> list[dict[str, Any]]:
    """Checksums of the local inputs of one source, verified against the register."""
    source = register.usable(source_id)
    inputs: list[dict[str, Any]] = []
    if source["kind"] == "python-package":
        package = source["package"]
        path = package_data_path(package)
        actual = sha256_file(path)
        if actual != package["sha256"]:
            raise SourceError(f"{source_id}: {package['data_file']} sha256 {actual} does not match the pinned {package['sha256']}.")
        inputs.append({"source_id": source_id, "file": package["data_file"], "package_version": package["version"], "sha256": actual})
        return inputs
    if source["kind"] == "built-database":
        from .esdb import content_sha256

        database = source["database"]
        path = source_dir(raw_dir, source_id) / database["name"]
        if not path.exists():
            raise SourceError(f"{source_id}/{database['name']} is missing. Build it as described in README §4 (`fetch --source {source_id}` prints the steps).")
        actual = content_sha256(path)
        if actual != database["content_sha256"]:
            raise SourceError(f"{source_id}/{database['name']}: content sha256 {actual} does not match the pinned {database['content_sha256']} (wrong release or a modified build).")
        inputs.append({"source_id": source_id, "file": f"{source_id}/{database['name']}", "content_sha256": actual, "build_commit": source["build"]["commit"]})
        return inputs
    for item in source["files"]:
        path = source_dir(raw_dir, source_id) / item["name"]
        if not path.exists():
            raise SourceError(f"{source_id}/{item['name']} is missing. Run `python -m vocabulary_data fetch --source {source_id}`.")
        actual = sha256_file(path)
        if actual != item["sha256"]:
            raise SourceError(f"{source_id}/{item['name']}: sha256 {actual} does not match the pinned {item['sha256']}.")
        inputs.append({"source_id": source_id, "file": f"{source_id}/{item['name']}", "sha256": actual})
    return inputs


def require_usable(register: SourceRegister, source_id: str, profile: str | None = None) -> dict[str, Any]:
    try:
        return register.usable(source_id, profile)
    except ManifestError as error:
        raise SourceError(str(error)) from error
