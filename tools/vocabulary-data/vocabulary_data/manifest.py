"""Source register and pipeline configuration: loading, validation, checksums.

The source register (sources/manifest.json) is the single record of where each
dataset comes from, which exact version is used, under which terms, and in
which execution profile it may be used. A run refuses a source that is not
approved for its profile, or whose metadata is incomplete.

Profiles:
- restricted: local analysis; may use restricted sources (wordfreq, ESDB);
  every output is restricted and stays in output/restricted/.
- redistributable: only sources whose redistribution terms are established
  (status "approved", distribution "attribution"); outputs go to
  output/redistributable/ and must not contain restricted data.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

TOOL_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_ROOT = TOOL_ROOT / "output"

PROFILES = ("restricted", "redistributable")
SOURCE_STATUSES = {"approved", "approved_internal", "deferred", "rejected"}
USABLE_STATUSES = {"approved", "approved_internal"}
DISTRIBUTIONS = {"attribution", "restricted", "not_used"}
# Most restrictive first: a run's outputs inherit the strictest distribution of the sources it used.
DISTRIBUTION_ORDER = ["restricted", "attribution"]
SOURCE_KINDS = {"files", "python-package", "built-database", "none"}
LICENCE_FLAGS = ("commercial_use", "modification", "redistribution", "attribution_required", "share_alike")
REQUIRED_SOURCE_FIELDS = ("id", "name", "url", "publisher", "version", "accessed", "status", "distribution", "licence", "role", "kind")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")


class ManifestError(ValueError):
    """The source register or configuration is invalid; the message says what to fix."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def _plain_name(name: Any) -> bool:
    return isinstance(name, str) and bool(name) and "/" not in name and "\\" not in name and not name.startswith(".")


def _validate_inputs(where: str, source: dict[str, Any], problems: list[str]) -> None:
    kind = source.get("kind")
    if kind == "files":
        files = source.get("files")
        if not isinstance(files, list) or not files:
            problems.append(f"{where}: no files listed.")
            return
        for item in files:
            if not isinstance(item, dict) or not item.get("url") or not _is_sha256(item.get("sha256")):
                problems.append(f"{where}: every file needs a name, a url and a sha256.")
            elif not _plain_name(item.get("name")):
                problems.append(f"{where}: file name '{item.get('name')}' must be a plain file name.")
    elif kind == "python-package":
        package = source.get("package")
        if not isinstance(package, dict) or not package.get("name") or not package.get("version") or not package.get("data_file") or not _is_sha256(package.get("sha256")):
            problems.append(f"{where}: package needs a name, an exact version, a data_file and its sha256.")
    elif kind == "built-database":
        build = source.get("build")
        database = source.get("database")
        if not isinstance(build, dict) or not build.get("repository") or not build.get("tag") or not _COMMIT.match(str(build.get("commit", ""))) or not build.get("command"):
            problems.append(f"{where}: build needs a repository, a tag, the full commit hash and the exact command.")
        elif not isinstance(build.get("inputs"), list) or not build["inputs"] or not all(isinstance(item, dict) and item.get("path") and _is_sha256(item.get("sha256")) for item in build["inputs"]):
            problems.append(f"{where}: build.inputs must pin every input file by path and sha256.")
        if not isinstance(database, dict) or not _plain_name(database.get("name")) or not _is_sha256(database.get("content_sha256")):
            problems.append(f"{where}: database needs a plain file name and its content_sha256.")
    else:
        problems.append(f"{where}: a usable source must have files, a package or a built database.")


def validate_manifest(data: Any) -> list[str]:
    """Every problem in a source register (empty list when valid)."""
    problems: list[str] = []
    if not isinstance(data, dict) or data.get("format") != "vocabulary-data-sources" or data.get("version") != 1:
        return ["Not a vocabulary-data source register (format/version)."]
    sources = data.get("sources")
    if not isinstance(sources, list) or not sources:
        return ["The register has no sources."]
    seen: set[str] = set()
    for index, source in enumerate(sources):
        where = f"sources[{index}]"
        if not isinstance(source, dict):
            problems.append(f"{where}: not an object.")
            continue
        source_id = source.get("id")
        where = f"source '{source_id}'" if isinstance(source_id, str) else where
        for field in REQUIRED_SOURCE_FIELDS:
            if field not in source:
                problems.append(f"{where}: missing '{field}'.")
        if isinstance(source_id, str):
            if source_id in seen:
                problems.append(f"{where}: duplicate id.")
            seen.add(source_id)
        status = source.get("status")
        distribution = source.get("distribution")
        if status not in SOURCE_STATUSES:
            problems.append(f"{where}: status must be one of {sorted(SOURCE_STATUSES)}.")
        if distribution not in DISTRIBUTIONS:
            problems.append(f"{where}: distribution must be one of {sorted(DISTRIBUTIONS)}.")
        if source.get("kind") not in SOURCE_KINDS:
            problems.append(f"{where}: kind must be one of {sorted(SOURCE_KINDS)}.")
        licence = source.get("licence")
        if not isinstance(licence, dict) or not licence.get("id") or not licence.get("evidence"):
            problems.append(f"{where}: licence needs an id and the evidence it was read from.")
            licence = {}
        profiles = source.get("profiles", [])
        if not isinstance(profiles, list) or any(profile not in PROFILES for profile in profiles):
            problems.append(f"{where}: profiles must list only {list(PROFILES)}.")
            profiles = []
        if status == "approved":
            # Usable in every profile listed: the licence must be fully established.
            for flag in LICENCE_FLAGS:
                if not isinstance(licence.get(flag), bool):
                    problems.append(f"{where}: licence.{flag} must be true or false for an approved source.")
            if licence.get("commercial_use") is not True or licence.get("modification") is not True or licence.get("redistribution") is not True:
                problems.append(f"{where}: an approved source must allow commercial use, modification and redistribution.")
            if distribution != "attribution":
                problems.append(f"{where}: an approved source has distribution 'attribution'.")
        elif status == "approved_internal":
            # Local analysis only: modification must be allowed; redistribution may be uncertain.
            if licence.get("modification") is not True:
                problems.append(f"{where}: an internally approved source must allow modification (local transformation).")
            if distribution != "restricted" or "redistributable" in profiles:
                problems.append(f"{where}: an internally approved source is restricted and never in the redistributable profile.")
            if not source.get("distribution_note"):
                problems.append(f"{where}: explain the restriction (distribution_note).")
        if status in USABLE_STATUSES:
            if not profiles:
                problems.append(f"{where}: list the profiles the source may be used in.")
            if not source.get("attribution"):
                problems.append(f"{where}: a usable source needs its attribution text.")
            _validate_inputs(where, source, problems)
        elif status in {"deferred", "rejected"}:
            if not source.get("deferred_reason"):
                problems.append(f"{where}: explain why it is {status} (deferred_reason).")
            if profiles:
                problems.append(f"{where}: a {status} source cannot be enabled in any profile.")
    return problems


@dataclass(frozen=True)
class SourceRegister:
    data: dict[str, Any]

    @property
    def sources(self) -> dict[str, dict[str, Any]]:
        return {source["id"]: source for source in self.data["sources"]}

    def usable(self, source_id: str, profile: str | None = None) -> dict[str, Any]:
        source = self.sources.get(source_id)
        if source is None:
            raise ManifestError(f"Source '{source_id}' is not in the register.")
        if source["status"] not in USABLE_STATUSES:
            raise ManifestError(f"Source '{source_id}' is {source['status']} and cannot be used: {source.get('deferred_reason', '')}")
        if profile is not None and profile not in source.get("profiles", []):
            raise ManifestError(f"Source '{source_id}' is not allowed in the {profile} profile (allowed: {', '.join(source.get('profiles', [])) or 'none'}).")
        return source


def load_register(path: Path) -> SourceRegister:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ManifestError(f"Cannot read the source register {path.name}: {error}") from error
    problems = validate_manifest(data)
    if problems:
        raise ManifestError("Invalid source register:\n- " + "\n- ".join(problems))
    return SourceRegister(data)


GOOGLE = "google-books-top-wordlists"
WORDFREQ = "wordfreq"
OEWN = "oewn-2025"
ESDB = "esdb-2026.02.25"
CONFIG_SOURCES = (GOOGLE, WORDFREQ, OEWN, ESDB)
FREQUENCY_SOURCES = (GOOGLE, WORDFREQ)
RANKING_METHODS = {"primary", "mean_log_rank"}


def enabled_sources(config: dict[str, Any]) -> list[str]:
    return sorted(source_id for source_id, settings in config.get("sources", {}).items() if isinstance(settings, dict) and settings.get("enabled"))


def validate_config(config: Any, register: SourceRegister) -> list[str]:
    problems: list[str] = []
    if not isinstance(config, dict) or config.get("format") != "vocabulary-data-config" or config.get("version") != 1:
        return ["Not a vocabulary-data configuration (format/version)."]
    profile = config.get("profile")
    if profile not in PROFILES:
        return [f"'profile' must be one of {list(PROFILES)}."]
    if config.get("language") != "en":
        problems.append("Only language 'en' is supported.")
    sources = config.get("sources")
    if not isinstance(sources, dict):
        return problems + ["'sources' must be an object."]
    for source_id, settings in sources.items():
        if source_id not in CONFIG_SOURCES:
            problems.append(f"Unknown source '{source_id}' in the configuration (no adapter).")
            continue
        if not isinstance(settings, dict) or not isinstance(settings.get("enabled"), bool):
            problems.append(f"sources.{source_id}.enabled must be true or false.")
            continue
        if settings["enabled"]:
            try:
                register.usable(source_id, profile)
            except ManifestError as error:
                problems.append(str(error))
            top_n = settings.get("pool_top_n")
            if source_id in FREQUENCY_SOURCES and (not isinstance(top_n, int) or top_n < 1):
                problems.append(f"sources.{source_id}.pool_top_n must be a positive integer.")
    enabled = set(enabled_sources(config))
    if not enabled & set(FREQUENCY_SOURCES):
        problems.append("Enable at least one frequency source.")
    ranking = config.get("ranking", {})
    if ranking.get("method") not in RANKING_METHODS:
        problems.append(f"ranking.method must be one of {sorted(RANKING_METHODS)}.")
    if ranking.get("method") == "primary" and ranking.get("primary_source") not in enabled:
        problems.append("ranking.primary_source must be an enabled frequency source.")
    if ranking.get("secondary_source") is not None and ranking.get("secondary_source") not in enabled:
        problems.append("ranking.secondary_source must be an enabled frequency source or null.")
    flags = config.get("flags", {})
    for key in ("proper_name_case_ratio", "acronym_case_ratio"):
        if not isinstance(flags.get(key), (int, float)):
            problems.append(f"flags.{key} must be a number.")
    if WORDFREQ in enabled and not isinstance(flags.get("low_frequency_zipf"), (int, float)):
        problems.append("flags.low_frequency_zipf must be a number when wordfreq is enabled.")
    return problems


def load_config(path: Path, register: SourceRegister) -> tuple[dict[str, Any], str]:
    """The configuration and the sha256 of its exact bytes (recorded in every run manifest)."""
    try:
        raw = path.read_bytes()
        config = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ManifestError(f"Cannot read the configuration {path.name}: {error}") from error
    problems = validate_config(config, register)
    if problems:
        raise ManifestError("Invalid configuration:\n- " + "\n- ".join(problems))
    return config, sha256_bytes(raw)


def strictest_distribution(sources: list[dict[str, Any]]) -> str:
    present = {source["distribution"] for source in sources}
    for level in DISTRIBUTION_ORDER:
        if level in present:
            return level
    return "attribution"
