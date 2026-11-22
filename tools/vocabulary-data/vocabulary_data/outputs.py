"""Writing, validating and comparing run outputs.

Determinism: candidates.json, candidates.csv, quality-report.json,
quality-report.md and ATTRIBUTION.md depend only on the inputs and the
configuration; they contain no dates and no machine paths. The execution date
and the dependency versions live only in run-manifest.json.
"""

from __future__ import annotations

import csv
import importlib.metadata
import io
import json
import platform
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .candidates import CANDIDATE_KINDS, CANDIDATE_STATUSES, EMPTY_ENRICHMENT, EVIDENCE_LEVELS, EXCLUSION_REASONS, LEMMA_STATUSES, candidate_record
from .manifest import OUTPUT_ROOT, PROFILES, TOOL_ROOT, sha256_bytes, sha256_file, strictest_distribution
from .pipeline import PipelineResult
from .reporting import build_report, render_markdown

DETERMINISTIC_OUTPUTS = ("candidates.json", "candidates.csv", "quality-report.json", "quality-report.md", "ATTRIBUTION.md")
RUN_MANIFEST = "run-manifest.json"
PACKAGES = ("wordfreq", "ftfy", "langcodes", "locate", "msgpack", "regex", "wcwidth")
# Machine-specific paths that must never appear in portable outputs.
_ABSOLUTE_PATH = re.compile(r"(?:\b[A-Za-z]:[\\/](?:Users|Documents|Windows)|/home/|/Users/|\\\\[A-Za-z])")
# Traces of restricted sources that must never appear in a redistributable output (checked case-insensitively).
# ("scowl" is not listed: it is an ordinary English word and appears as a candidate.)
RESTRICTED_MARKERS = ("wordfreq", "zipf", "esdb", "subtlex", "opensubtitles")


def profile_root(profile: str, output_root: Path = OUTPUT_ROOT) -> Path:
    """Each profile writes only under its own folder, so restricted and redistributable runs never mix."""
    if profile not in PROFILES:
        raise OutputError(f"Unknown profile {profile!r}.")
    return output_root / profile


def require_inside(out_dir: Path, profile: str, output_root: Path = OUTPUT_ROOT) -> None:
    root = profile_root(profile, output_root).resolve()
    try:
        out_dir.resolve().relative_to(root)
    except ValueError as error:
        raise OutputError(f"A {profile} run must be written under {portable_path(root)}/ (got {portable_path(out_dir)}).") from error


class OutputError(RuntimeError):
    pass


def portable_path(path: Path) -> str:
    """A path relative to the tool folder when possible, else just the file name."""
    try:
        return path.resolve().relative_to(TOOL_ROOT).as_posix()
    except ValueError:
        return path.name


def _csv_row(record: dict[str, Any], sources: list[str]) -> list[str]:
    def joined(values: list[Any]) -> str:
        return "|".join(str(value) for value in values)

    disagreement = record["frequency_disagreement"]
    cap = record["capitalization"]
    row = [
        record["candidate_id"],
        record["language"],
        record["surface_form"],
        record["normalized_form"],
        record["candidate_kind"],
        record["candidate_status"],
        joined(record["exclusion_reasons"]),
        record["folded_into"] or "",
        joined(record["folded_forms"]),
        record["fold_basis"] or "",
        record["lemma"] or "",
        record["lemma_status"],
        record["evidence_level"],
        joined(f"{item['relation']}:{item.get('written', item['lemma'])}/{item['pos']}" for item in record["lemma_analyses"]),
        joined(record["part_of_speech"]),
        record["part_of_speech_status"],
        joined(f"{item['form']}/{item['variety']}" for item in record["spelling_variants"]),
        joined(record["source_ids"]),
        str(record["source_coverage"]),
    ]
    for source_id in sources:
        frequency = record["frequency"][source_id]
        grouped = frequency["with_folded_forms"]
        row += [
            str(frequency["rank"]),
            "true" if frequency["rank_censored"] else "false",
            "" if frequency["value"] is None else f"{frequency['value']:.2f}",
            "" if grouped is None else str(grouped["rank"]),
        ]
    row += [
        str(record["combined_rank"]),
        "" if record["retained_rank"] is None else str(record["retained_rank"]),
        "" if disagreement is None else f"{disagreement['direction']}:{disagreement['log10_rank_ratio']}",
        cap.get("pattern") or "",
        "" if cap.get("capitalized_vs_lower") is None else str(cap["capitalized_vs_lower"]),
        "" if cap.get("upper_vs_lower") is None else str(cap["upper_vs_lower"]),
        joined(record["flags"]),
        record["origin"],
        record["review_status"],
    ]
    return row


def csv_header(sources: list[str]) -> list[str]:
    header = [
        "candidate_id", "language", "surface_form", "normalized_form", "candidate_kind", "candidate_status", "exclusion_reasons",
        "folded_into", "folded_forms", "fold_basis", "lemma", "lemma_status", "evidence_level", "lemma_analyses", "part_of_speech", "part_of_speech_status",
        "spelling_variants", "source_ids", "source_coverage",
    ]
    for source_id in sources:
        header += [f"{source_id}:rank", f"{source_id}:rank_censored", f"{source_id}:value", f"{source_id}:rank_with_folded_forms"]
    header += ["combined_rank", "retained_rank", "frequency_disagreement", "capitalization_pattern", "capitalized_vs_lower", "upper_vs_lower", "flags", "origin", "review_status"]
    return header


def attribution_markdown(sources: list[dict[str, Any]], distribution: str) -> str:
    lines = [
        "# Attribution and licences",
        "",
        f"Distribution status of this run: **{distribution}**.",
        "",
    ]
    if distribution == "restricted":
        restricted = ", ".join(f"`{source['id']}`" for source in sources if source["distribution"] == "restricted")
        lines += [
            f"These outputs contain data from restricted sources ({restricted}; see the notes below).",
            "Keep them local for review; do not commit, publish or ship them in app packs.",
            "",
        ]
    else:
        lines += [
            "Every source below is approved for redistribution with attribution. Each keeps its own licence and attribution;",
            "no single licence is claimed for the combination.",
            "",
        ]
    for source in sources:
        licence = source["licence"]
        lines += [
            f"## {source['name']}",
            "",
            f"- Source id: `{source['id']}` · version: {source['version']} · accessed {source['accessed']}",
            f"- Licence: {licence['id']} ({licence['url']})",
            f"- Status in this pipeline: {source['status']} · distribution: {source['distribution']}",
            f"- Attribution: {source['attribution']}",
        ]
        if source.get("distribution_note"):
            lines.append(f"- Note: {source['distribution_note']}")
        lines.append("")
    return "\n".join(lines)


def _dependency_versions() -> dict[str, str | None]:
    versions: dict[str, str | None] = {}
    for name in PACKAGES:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    return versions


def render_outputs(result: PipelineResult, config: dict[str, Any], config_sha256: str, pipeline_version: str) -> dict[str, bytes]:
    """The deterministic outputs, as bytes (written by `write_run`, compared by tests)."""
    sources = result.enabled_frequency_sources
    distribution = strictest_distribution(result.used_sources)
    records = [candidate_record(candidate, sources) for candidate in result.candidates]
    header = {
        "format": "vocabulary-data-candidates",
        "version": 1,
        "pipeline_version": pipeline_version,
        "profile": result.profile,
        "config_sha256": config_sha256,
        "language": "en",
        "distribution": distribution,
        "frequency_sources": sources,
        "sources": [{"id": source["id"], "version": source["version"], "licence": source["licence"]["id"], "attribution": source["attribution"]} for source in result.used_sources],
        "candidate_count": len(records),
    }
    # One candidate per line keeps the JSON valid, diffable and readable in chunks.
    body = ",\n".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) for record in records)
    head = json.dumps(header, ensure_ascii=False, indent=2)
    candidates_json = head[:-2] + ',\n  "candidates": [\n' + body + "\n  ]\n}\n"

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(csv_header(sources))
    for record in records:
        writer.writerow(_csv_row(record, sources))

    report = build_report(result, config, config_sha256, pipeline_version)
    return {
        "candidates.json": candidates_json.encode("utf-8"),
        "candidates.csv": buffer.getvalue().encode("utf-8"),
        "quality-report.json": (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        "quality-report.md": (render_markdown(report, distribution) + "\n").encode("utf-8"),
        "ATTRIBUTION.md": (attribution_markdown(result.used_sources, distribution) + "\n").encode("utf-8"),
    }


def write_run(
    out_dir: Path,
    result: PipelineResult,
    config: dict[str, Any],
    config_path: Path,
    config_sha256: str,
    register_path: Path,
    pipeline_version: str,
    output_root: Path = OUTPUT_ROOT,
) -> dict[str, Any]:
    require_inside(out_dir, result.profile, output_root)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise OutputError(f"{portable_path(out_dir)} already contains files; choose a new output folder (previous runs are never overwritten).")
    out_dir.mkdir(parents=True, exist_ok=True)
    rendered = render_outputs(result, config, config_sha256, pipeline_version)
    for name, data in rendered.items():
        (out_dir / name).write_bytes(data)
    manifest = {
        "format": "vocabulary-data-run",
        "version": 1,
        "pipeline_version": pipeline_version,
        "profile": result.profile,
        "executed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "python": platform.python_version(),
        # A redistributable run records no restricted package versions either.
        "dependencies": _dependency_versions() if result.profile == "restricted" else {},
        "config": {"file": portable_path(config_path), "sha256": config_sha256},
        "source_register": {"file": portable_path(register_path), "sha256": sha256_file(register_path)},
        "sources": [{"id": source["id"], "version": source["version"], "licence": source["licence"]["id"], "status": source["status"], "distribution": source["distribution"]} for source in result.used_sources],
        "inputs": result.inputs,
        "distribution": strictest_distribution(result.used_sources),
        "outputs": [{"file": name, "sha256": sha256_bytes(data), "bytes": len(data)} for name, data in rendered.items()],
    }
    (out_dir / RUN_MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def validate_run(out_dir: Path) -> list[str]:
    """Every problem found in a run folder (empty when it is consistent)."""
    problems: list[str] = []
    manifest_path = out_dir / RUN_MANIFEST
    if not manifest_path.exists():
        return [f"{RUN_MANIFEST} is missing."]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for output in manifest.get("outputs", []):
        path = out_dir / output["file"]
        if not path.exists():
            problems.append(f"{output['file']} is missing.")
        elif sha256_file(path) != output["sha256"]:
            problems.append(f"{output['file']} does not match its checksum in the run manifest.")
    for name in (*DETERMINISTIC_OUTPUTS, RUN_MANIFEST):
        path = out_dir / name
        if path.exists() and _ABSOLUTE_PATH.search(path.read_text(encoding="utf-8")):
            problems.append(f"{name} contains a machine-specific absolute path.")
    try:
        document = json.loads((out_dir / "candidates.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return problems + [f"candidates.json is not valid JSON: {error}"]
    records = document.get("candidates", [])
    if document.get("candidate_count") != len(records):
        problems.append("candidate_count does not match the number of candidates.")
    ids = [record.get("candidate_id") for record in records]
    if len(set(ids)) != len(ids):
        problems.append("candidate ids are not unique.")
    by_id = {record["candidate_id"]: record for record in records}
    expected_retained = 0
    for position, record in enumerate(records, start=1):
        where = record.get("candidate_id", f"#{position}")
        if record.get("combined_rank") != position:
            problems.append(f"{where}: combined_rank is not sequential.")
        if record.get("candidate_status") not in CANDIDATE_STATUSES or record.get("lemma_status") not in LEMMA_STATUSES or record.get("candidate_kind") not in CANDIDATE_KINDS:
            problems.append(f"{where}: unknown status or kind.")
        if record["candidate_status"] == "retained":
            expected_retained += 1
            if record.get("retained_rank") != expected_retained:
                problems.append(f"{where}: retained_rank is not sequential.")
            if record["exclusion_reasons"]:
                problems.append(f"{where}: retained but has exclusion reasons.")
        elif record["candidate_status"] == "excluded":
            if not record["exclusion_reasons"] or any(reason not in EXCLUSION_REASONS for reason in record["exclusion_reasons"]):
                problems.append(f"{where}: excluded without a known reason.")
        elif record["candidate_status"] == "folded":
            target = by_id.get(record.get("folded_into") or "")
            if target is None or target["candidate_status"] != "retained" or record["normalized_form"] not in target["folded_forms"]:
                problems.append(f"{where}: folded into a missing or non-retained candidate.")
        if record.get("enrichment") != EMPTY_ENRICHMENT or record.get("review_status") != "unreviewed":
            problems.append(f"{where}: enrichment or review fields are filled; this pipeline must not invent them.")
        if record.get("evidence_level") not in EVIDENCE_LEVELS:
            problems.append(f"{where}: unknown evidence level.")
    try:
        with (out_dir / "candidates.csv").open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
    except OSError as error:
        return problems + [f"candidates.csv cannot be read: {error}"]
    if [row["candidate_id"] for row in rows] != ids:
        problems.append("candidates.csv and candidates.json list different candidates or orders.")
    elif any(row["candidate_status"] != record["candidate_status"] or row["lemma_status"] != record["lemma_status"] for row, record in zip(rows, records)):
        problems.append("candidates.csv and candidates.json disagree on statuses.")
    attribution = (out_dir / "ATTRIBUTION.md").read_text(encoding="utf-8") if (out_dir / "ATTRIBUTION.md").exists() else ""
    for source in manifest.get("sources", []):
        if f"`{source['id']}`" not in attribution:
            problems.append(f"ATTRIBUTION.md does not credit {source['id']}.")
    credited = set(re.findall(r"Source id: `([^`]+)`", attribution))
    if credited != {source["id"] for source in manifest.get("sources", [])}:
        problems.append("ATTRIBUTION.md credits sources the run did not use (or misses some).")
    profile = manifest.get("profile")
    if profile not in PROFILES or document.get("profile") != profile:
        problems.append("The run manifest and candidates.json disagree on the profile (or it is missing).")
    if profile == "redistributable":
        problems += _redistributable_problems(out_dir, manifest, document, records)
    return problems


def _redistributable_problems(out_dir: Path, manifest: dict[str, Any], document: dict[str, Any], records: list[dict[str, Any]]) -> list[str]:
    """A redistributable run must hold no trace of restricted sources: structure first, then a text scan."""
    problems: list[str] = []
    if manifest.get("distribution") != "attribution" or any(source.get("distribution") != "attribution" or source.get("status") != "approved" for source in manifest.get("sources", [])):
        problems.append("A redistributable run used a source that is not approved for redistribution.")
    allowed = {source["id"] for source in manifest.get("sources", [])}
    if not set(document.get("frequency_sources", [])) <= allowed:
        problems.append("candidates.json lists frequency sources outside the run's approved sources.")
    for record in records:
        if not set(record.get("frequency", {})) <= allowed or not set(record.get("source_ids", [])) <= allowed:
            problems.append(f"{record['candidate_id']}: frequency data from a source outside the run's approved sources.")
            break
        if any(str(item.get("relation", "")).startswith("esdb") for item in record.get("lemma_analyses", [])):
            problems.append(f"{record['candidate_id']}: ESDB evidence in a redistributable output.")
            break
    if manifest.get("dependencies"):
        problems.append("A redistributable run manifest lists restricted package versions.")
    for name in (*DETERMINISTIC_OUTPUTS, RUN_MANIFEST):
        path = out_dir / name
        if path.exists():
            text = path.read_text(encoding="utf-8").lower()
            found = [marker for marker in RESTRICTED_MARKERS if marker in text]
            if found:
                problems.append(f"{name} mentions restricted sources ({', '.join(found)}).")
    return problems


def compare_runs(first: Path, second: Path) -> list[str]:
    """Differences between the deterministic outputs of two runs (empty when identical)."""
    differences = []
    for name in DETERMINISTIC_OUTPUTS:
        a, b = first / name, second / name
        if not a.exists() or not b.exists():
            differences.append(f"{name}: missing in one run.")
        elif sha256_file(a) != sha256_file(b):
            differences.append(f"{name}: differs.")
    return differences
