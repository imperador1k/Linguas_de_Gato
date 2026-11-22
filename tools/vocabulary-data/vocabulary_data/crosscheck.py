"""Restricted cross-check of a pilot proposal (local only).

Looks up every proposed entry in a *restricted* run and reports what the
restricted sources say about it: ESDB morphology (is the word also an inflected
form? are there other readings?) and wordfreq's everyday frequency. The result
helps human review; it is restricted, written under output/restricted/, and
never fed back into the proposal.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .manifest import OUTPUT_ROOT, WORDFREQ, sha256_bytes, sha256_file
from .outputs import OutputError, portable_path, require_inside

RARE_ZIPF = 3.0


def render_crosscheck(pilot_dir: Path, restricted_run: Path) -> dict[str, bytes]:
    if not (restricted_run / "run-manifest.json").is_file() or not (pilot_dir / "pilot-proposal.json").is_file():
        raise OutputError(f"Expected a restricted run folder ({portable_path(restricted_run)}) and a pilot folder ({portable_path(pilot_dir)}).")
    run_manifest = json.loads((restricted_run / "run-manifest.json").read_text(encoding="utf-8"))
    if run_manifest.get("profile") != "restricted":
        raise OutputError("The cross-check needs a restricted run.")
    proposal = json.loads((pilot_dir / "pilot-proposal.json").read_text(encoding="utf-8"))
    document = json.loads((restricted_run / "candidates.json").read_text(encoding="utf-8"))
    by_id = {record["candidate_id"]: record for record in document["candidates"]}
    rows = []
    for entry in proposal["entries"]:
        record = by_id.get(entry["candidate_id"])
        if record is None:
            rows.append({"candidate_id": entry["candidate_id"], "surface_form": entry["surface_form"], "pilot_group": entry["pilot_group"], "notes": ["not in the restricted run"]})
            continue
        form = record["normalized_form"]
        esdb_readings = [item for item in record["lemma_analyses"] if str(item.get("relation", "")).startswith("esdb")]
        # Forms of the word itself ("read" as past tense of "read", "fruit" as plural of "fruit") are not other words.
        other_word = [item for item in esdb_readings if item["relation"] == "esdb_derived_form" and item["lemma"] != form]
        derived = sorted({f"{item['lemma']} ({item['form_type']}{', minor' if item.get('minor') else ''})" for item in other_word})
        zipf = (record["frequency"].get(WORDFREQ) or {}).get("value")
        notes = []
        if any(not item.get("minor") for item in other_word):
            notes.append("ESDB also lists it as a form of another word")
        if record["lemma_status"] != entry["dictionary_form_status"]:
            notes.append(f"restricted profile: {record['lemma_status']} (redistributable: {entry['dictionary_form_status']})")
        missing_pos = sorted(set(record["part_of_speech"]) - set(entry["part_of_speech"]))
        if missing_pos:
            # E.g. "by": the approved lexicon only has the adverb; ESDB also has the preposition.
            notes.append(f"parts of speech only the restricted sources know: {', '.join(missing_pos)}")
        if zipf is None or zipf < RARE_ZIPF:
            notes.append(f"rare in everyday sources (Zipf {zipf})")
        rows.append(
            {
                "candidate_id": entry["candidate_id"],
                "surface_form": entry["surface_form"],
                "pilot_group": entry["pilot_group"],
                "restricted_lemma_status": record["lemma_status"],
                "restricted_part_of_speech": record["part_of_speech"],
                "esdb_derived_readings": derived,
                "everyday_zipf": zipf,
                "notes": notes,
            }
        )
    summary = Counter(note.split(" (")[0].split(":")[0] for row in rows for note in row["notes"])
    report = {
        "format": "vocabulary-data-pilot-crosscheck",
        "version": 1,
        "profile": "restricted",
        "distribution": "restricted",
        "entries": len(rows),
        "entries_with_notes": sum(1 for row in rows if row["notes"]),
        "note_counts": dict(sorted(summary.items())),
        "rows": rows,
    }
    lines = [
        "# Pilot cross-check (RESTRICTED — local only)",
        "",
        "Restricted sources (ESDB morphology, wordfreq frequency) on the redistributable pilot proposal. Do not commit or share.",
        "",
        f"{report['entries']} entries; {report['entries_with_notes']} with notes: " + ", ".join(f"{key}: {value}" for key, value in report["note_counts"].items()),
        "",
        "| Entry | Group | Restricted status | ESDB derived readings | Everyday Zipf | Notes |",
        "| --- | --- | --- | --- | ---: | --- |",
        *[
            f"| {row['surface_form']} | {row['pilot_group']} | {row.get('restricted_lemma_status', '')} | {', '.join(row.get('esdb_derived_readings', []))} | {row.get('everyday_zipf', '')} | {'; '.join(row['notes'])} |"
            for row in rows
            if row["notes"]
        ],
        "",
    ]
    return {"crosscheck.json": (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), "crosscheck.md": "\n".join(lines).encode("utf-8")}


def write_crosscheck(pilot_dir: Path, restricted_run: Path, out_dir: Path, output_root: Path = OUTPUT_ROOT) -> dict[str, Any]:
    require_inside(out_dir, "restricted", output_root)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise OutputError(f"{portable_path(out_dir)} already contains files; choose a new folder.")
    rendered = render_crosscheck(pilot_dir, restricted_run)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, data in rendered.items():
        (out_dir / name).write_bytes(data)
    manifest = {
        "format": "vocabulary-data-crosscheck-run",
        "profile": "restricted",
        "executed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "pilot": portable_path(pilot_dir),
        "pilot_proposal_sha256": sha256_file(pilot_dir / "pilot-proposal.json"),
        "restricted_run": portable_path(restricted_run),
        "outputs": [{"file": name, "sha256": sha256_bytes(data)} for name, data in rendered.items()],
    }
    (out_dir / "crosscheck-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest
