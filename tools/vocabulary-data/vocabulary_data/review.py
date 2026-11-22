"""The human-review package for a pilot proposal (redistributable data only).

Inputs: a redistributable pilot folder and the redistributable run it was built
from (the pilot records the run's candidates checksum; it must match).

Outputs, all in one new folder under output/redistributable/:
- review-all.csv            every pilot candidate, once, with provenance and empty review columns;
- review-batch-1..N.csv     the same rows split round-robin into N batches (each batch spans every
                            group and rank band, so reviewers calibrate on the whole range);
- function-word-coverage.md / .csv   how the approved sources cover a checklist of function words;
- pilot-overview.md         composition, ambiguity, gaps and examples for reviewers;
- COLUMNS.md                what every column means;
- ATTRIBUTION.md            copied from the pilot;
- review-manifest.json      checksums and traceability.

Nothing here is restricted data, nothing is a review decision, and nothing becomes an
app pack entry automatically: every human-review column starts empty.
"""

from __future__ import annotations

import csv
import io
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .manifest import GOOGLE, OUTPUT_ROOT, sha256_bytes, sha256_file
from .outputs import RESTRICTED_MARKERS, OutputError, portable_path, require_inside

REVIEW_DECISIONS = ("accept", "accept_with_edits", "split_by_pos", "split_senses", "merge_into", "reject", "defer")
PEDAGOGICAL_USEFULNESS = ("essential_everyday", "useful_general", "context_specific", "specialist", "low_priority_or_obscure")
BEGINNER_RELEVANCE = ("core", "useful", "not_beginner_priority", "uncertain")

PROVENANCE_COLUMNS = [
    "batch", "pilot_index", "candidate_id", "surface_form", "normalized_form", "proposed_lemma", "lemma_evidence",
    "part_of_speech", "alternative_parts_of_speech", "source_ids", "source_rankings", "source_coverage", "rank_band",
    "morphology_evidence", "spelling_variant_information", "quality_flags", "potential_false_positive_signals",
    "licensing_status", "inclusion_group", "pilot_selection_reason", "review_status",
]
REVIEW_COLUMNS = [
    "reviewer_decision", "approved_lemma", "approved_parts_of_speech", "approved_senses", "lexical_review_notes",
    "pedagogical_usefulness", "beginner_relevance", "recommended_learning_priority", "reviewer_comments",
]
COLUMNS = PROVENANCE_COLUMNS + REVIEW_COLUMNS
UNKNOWN = "unknown"

COLUMN_DOCS = {
    "batch": "Review batch (1..N). Rows are dealt round-robin in pilot order, so each batch spans all groups and rank bands.",
    "pilot_index": "Position in the pilot proposal (ordered by source rank).",
    "candidate_id": "Stable candidate id (`en:` + normalised form), the key back to the pilot and the run.",
    "surface_form": "Spelling to show (the dominant capitalisation when it clearly dominates).",
    "normalized_form": "Join key: NFC, lower case, unified apostrophes and hyphens; spelling and accents kept.",
    "proposed_lemma": "Dictionary form established by the approved lexicon; empty when the identity is ambiguous (see lemma_evidence).",
    "lemma_evidence": "Lemma status and every reading with its source, e.g. `lemma: is_lemma found (verb) [oewn-2025]; explicit_form find (verb) [oewn-2025]`.",
    "part_of_speech": "Parts of speech the approved lexicon gives this spelling as a dictionary form (`|`-separated); `unknown` if none.",
    "alternative_parts_of_speech": "Parts of speech of other readings (e.g. as a form of another word), with that word; empty if none.",
    "source_ids": "Sources that contributed: frequency source(s) where the form was observed, and the lexicon used.",
    "source_rankings": "Original source rank (and the rank of the lemma with its explicit forms, when different). Redistribution permitted.",
    "source_coverage": "Number of frequency sources the form was observed in (this profile has one frequency source).",
    "rank_band": "Pilot rank band (Google Books rank).",
    "morphology_evidence": "Explicit forms attached to this lemma (folded forms) and other morphology readings with their source.",
    "spelling_variant_information": "Spelling variants from Open English WordNet spelling markers (variety, shared synsets). Variants are linked, not merged.",
    "quality_flags": "Pipeline flags (`|`-separated). Flags are reasons to look, not decisions.",
    "potential_false_positive_signals": "Reasons to doubt the lexicon match (normally empty for pilot entries).",
    "licensing_status": "Licensing of the data in this row, per source. No single licence is claimed for the combination.",
    "inclusion_group": "Pilot group (core band, irregular lemma, spelling-variant pair, review group).",
    "pilot_selection_reason": "Why the pilot selected this candidate.",
    "review_status": "`pending_human_review` until a reviewer records a decision.",
    "reviewer_decision": f"One of: {', '.join(REVIEW_DECISIONS)} (see docs/VOCABULARY_PILOT_REVIEW.md).",
    "approved_lemma": "The dictionary form the reviewer approves (for merge_into: the target candidate's lemma).",
    "approved_parts_of_speech": "Parts of speech approved as separate lexical entries (`|`-separated).",
    "approved_senses": "Senses to distinguish, short glosses separated by `;` (no definitions are written here).",
    "lexical_review_notes": "Evidence checked, doubts, variant or inflection notes.",
    "pedagogical_usefulness": f"One of: {', '.join(PEDAGOGICAL_USEFULNESS)}.",
    "beginner_relevance": f"Preliminary, human judgement, not a CEFR level: {', '.join(BEGINNER_RELEVANCE)}.",
    "recommended_learning_priority": "Free text or a reviewer scale (e.g. high/medium/low); not derived from rank.",
    "reviewer_comments": "Anything else, including the reviewer's initials and date if useful.",
}


def _join(values: list[str]) -> str:
    return "|".join(values)


def _reading(item: dict[str, Any]) -> str:
    source = str(item.get("evidence", "")).split(":")[0].split(" ")[0]
    return f"{item['relation']} {item.get('written', item['lemma'])} ({item.get('pos') or UNKNOWN}) [{source}]"


def review_row(entry: dict[str, Any], record: dict[str, Any], batch: int) -> dict[str, str]:
    analyses = entry["morphology_evidence"]
    lemma_pos = sorted({item["pos"] for item in analyses if item["relation"] == "is_lemma" and item.get("pos")})
    other = sorted({f"{item['pos']} (as {item['relation'].replace('_', ' ')} of {item['lemma']})" for item in analyses if item["relation"] != "is_lemma" and item.get("pos")})
    frequency = record["frequency"][GOOGLE]
    grouped = (frequency.get("with_folded_forms") or {}).get("rank")
    rankings = f"{GOOGLE}:rank={frequency['rank']}" + (f";with_explicit_forms={grouped}" if grouped and grouped != frequency["rank"] else "")
    lexicon_sources = sorted({str(item.get("evidence", "")).split(":")[0].split(" ")[0] for item in analyses if item.get("evidence")})
    morphology = [f"explicit forms: {', '.join(entry['folded_forms'])} [oewn-2025]"] if entry["folded_forms"] else []
    morphology += [_reading(item) for item in analyses if item["relation"] != "is_lemma"]
    variants = [f"{variant['form']} ({variant['variety']}; shared synsets {', '.join(variant.get('shared_synsets', [])) or UNKNOWN})" for variant in entry["spelling_variants"]]
    licensing = "; ".join(f"{source['id']} {source['licence']}" for source in entry["licensing"]["sources"])
    row = {
        "batch": str(batch),
        "pilot_index": str(entry["pilot_index"]),
        "candidate_id": entry["candidate_id"],
        "surface_form": entry["surface_form"],
        "normalized_form": record["normalized_form"],
        "proposed_lemma": entry["proposed_dictionary_form"] or "",
        "lemma_evidence": f"{entry['dictionary_form_status']}: " + "; ".join(_reading(item) for item in analyses),
        "part_of_speech": _join(lemma_pos) or UNKNOWN,
        "alternative_parts_of_speech": "; ".join(other),
        "source_ids": _join(sorted(set(record["source_ids"]) | set(lexicon_sources))),
        "source_rankings": rankings,
        "source_coverage": str(record["source_coverage"]),
        "rank_band": entry["rank_band"],
        "morphology_evidence": "; ".join(morphology),
        "spelling_variant_information": "; ".join(variants),
        "quality_flags": _join(entry["flags"]),
        "potential_false_positive_signals": _join(entry["potential_false_positive_signals"]),
        "licensing_status": f"{entry['licensing']['status']} ({licensing})",
        "inclusion_group": entry["pilot_group"],
        "pilot_selection_reason": entry["inclusion_reason"],
        "review_status": entry["review_status"],
    }
    row.update({column: "" for column in REVIEW_COLUMNS})
    return row


def _csv(rows: list[dict[str, str]]) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def function_word_coverage(records: list[dict[str, Any]], pilot_ids: set[str], checklist: dict[str, Any]) -> list[dict[str, str]]:
    by_form = {record["normalized_form"]: record for record in records}
    rows = []
    for category, words in checklist["categories"].items():
        roles = set(checklist["function_parts_of_speech"].get(category, []))
        for word in words:
            record = by_form.get(word)
            if record is None:
                status, detail = "missing", "not a candidate (not in the redistributable frequency pool)"
                pos, rank, evidence, in_pilot = "", "", "", "no"
            else:
                pos = _join(record["part_of_speech"])
                rank = str(record["frequency"][GOOGLE]["rank"]) if not record["frequency"][GOOGLE]["rank_censored"] else ""
                evidence = record["evidence_level"]
                in_pilot = "yes" if record["candidate_id"] in pilot_ids else "no"
                if record["candidate_status"] == "folded":
                    status, detail = "folded", f"attached to {record['folded_into']} as an explicit form"
                elif record["candidate_status"] == "excluded":
                    status, detail = "excluded", _join(record["exclusion_reasons"])
                elif record["evidence_level"] == "no_evidence":
                    status, detail = "unsupported", "no dictionary form in the approved lexicon"
                elif record["lemma_status"] == "ambiguous":
                    status, detail = "ambiguous", "several readings in the approved lexicon"
                elif roles and not roles & set(record["part_of_speech"]):
                    status, detail = "pos_missing", f"the approved lexicon gives only: {pos or 'nothing'}"
                else:
                    status, detail = "supported", "dictionary form with a matching part of speech"
            rows.append({"category": category, "word": word, "coverage": status, "detail": detail, "approved_lexicon_pos": pos, "google_rank": rank, "evidence_level": evidence, "in_pilot": in_pilot})
    return rows


def _coverage_markdown(rows: list[dict[str, str]]) -> str:
    out = [
        "# Function-word coverage (redistributable sources)",
        "",
        "How the approved, redistributable sources (Google Books top lists and Open English WordNet) cover a checklist of",
        "function words. The checklist (`config/function-word-checklist.json`) is a review aid, not lexical evidence; nothing",
        "here adds, removes or changes a candidate. See docs/VOCABULARY_PILOT_REVIEW.md for what to do about the gaps.",
        "",
        "Coverage values: `supported` (dictionary form with a matching part of speech), `pos_missing` (a dictionary form",
        "exists but not with the function role), `ambiguous`, `unsupported` (no dictionary form), `folded` (attached to",
        "another lemma), `excluded`, `missing` (not a candidate at all).",
        "",
        "| Category | supported | pos_missing | ambiguous | unsupported | folded | excluded | missing | in pilot |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    categories = list(dict.fromkeys(row["category"] for row in rows))
    for category in categories:
        counts = Counter(row["coverage"] for row in rows if row["category"] == category)
        in_pilot = sum(1 for row in rows if row["category"] == category and row["in_pilot"] == "yes")
        out.append(f"| {category} | " + " | ".join(str(counts.get(key, 0)) for key in ("supported", "pos_missing", "ambiguous", "unsupported", "folded", "excluded", "missing")) + f" | {in_pilot} |")
    out += ["", "## Details", ""]
    for category in categories:
        out.append(f"### {category}")
        out.append("")
        for status in ("pos_missing", "ambiguous", "unsupported", "folded", "excluded", "missing", "supported"):
            words = [f"{row['word']}" + (f" ({row['approved_lexicon_pos']})" if status == "pos_missing" and row["approved_lexicon_pos"] else "") for row in rows if row["category"] == category and row["coverage"] == status]
            if words:
                out.append(f"- **{status}**: {', '.join(words)}")
        out.append("")
    return "\n".join(out)


def _overview(entries: list[dict[str, Any]], records_by_id: dict[str, dict[str, Any]], pilot_report: dict[str, Any], coverage: list[dict[str, str]]) -> str:
    groups = Counter(entry["pilot_group"] for entry in entries)
    pos_counts = Counter(pos for entry in entries for pos in entry["part_of_speech"])
    multi = [entry for entry in entries if len(entry["part_of_speech"]) > 1]
    ambiguous = [entry for entry in entries if entry["dictionary_form_status"] == "ambiguous"]
    deep = [entry for entry in entries if entry["rank_band"] in {"12001-25000", "25001-60000"} and entry["pilot_group"].startswith("core")]
    review_groups = [entry for entry in entries if entry["pilot_group"] in {"review:acronym_likely", "review:capitalization_ambiguous"}]
    gaps = Counter(row["coverage"] for row in coverage)

    def words(items: list[dict[str, Any]], count: int = 15) -> str:
        return ", ".join(f"{entry['surface_form']} ({'|'.join(entry['part_of_speech'])})" for entry in items[:count]) or "(none)"

    out = [
        "# Pilot overview for reviewers",
        "",
        f"**{len(entries)} candidates** from the redistributable pilot proposal. This is a **lexical review proposal**, not final",
        "content: not a learner catalogue, not an A1 curriculum, and not necessarily 400 learning entries. The content unit",
        "after review is *lemma + part of speech + sense*: one candidate spelling may become several entries, or none.",
        "",
        "## Groups",
        "",
        "| Group | Candidates |",
        "| --- | ---: |",
        *[f"| {group} | {count} |" for group, count in sorted(groups.items())],
        "",
        "## Parts of speech (a candidate can have several)",
        "",
        "| Part of speech | Candidates |",
        "| --- | ---: |",
        *[f"| {pos} | {count} |" for pos, count in sorted(pos_counts.items())],
        "",
        f"- Candidates with several parts of speech: **{len(multi)}** (each part of speech may need its own entry).",
        f"- Dictionary form established by the approved lexicon: **{pilot_report['dictionary_form_confirmed']}**; ambiguous identity: **{len(ambiguous)}**.",
        f"- Lemmas with explicit irregular forms: {pilot_report['irregular_lemmas']}; spelling-variant entries: {pilot_report['spelling_variant_entries']}.",
        "",
        "## Ambiguous identities (decide the entry or entries)",
        "",
        "; ".join(f"{entry['surface_form']}: {', '.join(entry['dictionary_form_options'])}" for entry in ambiguous),
        "",
        "## Function words in the pilot with an incomplete part of speech",
        "",
        "The approved lexicon has no prepositions, determiners, pronouns, conjunctions or modal roles, so these pilot",
        "candidates carry only other parts of speech. Check the function role by hand (lexical_review_notes):",
        "",
        ", ".join(sorted({f"{row['word']} ({row['category']}; lexicon: {row['approved_lexicon_pos'] or 'none'})" for row in coverage if row["in_pilot"] == "yes" and row["coverage"] == "pos_missing"})) or "(none)",
        "",
        "## Examples that probably need splitting (several parts of speech)",
        "",
        words(multi, 25),
        "",
        "These are suggestions for the reviewer, not decisions.",
        "",
        "## Examples to consider rejecting or deferring",
        "",
        f"- Review group, names and acronyms that may not be learner vocabulary: {words(review_groups, 20)}",
        f"- Deep rank bands (book-heavy, possibly specialist): {words(deep, 25)}",
        "",
        "These are prompts to look closely, not decisions; some will be accepted.",
        "",
        "## Coverage gaps",
        "",
        f"- Function-word checklist ({len(coverage)} items): " + ", ".join(f"{key} {value}" for key, value in sorted(gaps.items())) + " (see function-word-coverage.md).",
        *[f"- {note}" for note in pilot_report["coverage_gaps"]["notes"]],
        "",
        "## Licensing",
        "",
        *[f"- `{source['id']}`: {source['licence']} ({source['version']})" for source in pilot_report["licensing"]["sources"]],
        "",
        "Each source keeps its own licence and attribution (ATTRIBUTION.md); no single licence is claimed for the combination.",
        "No restricted source contributed to this package.",
        "",
    ]
    return "\n".join(out)


def _columns_markdown(batches: int) -> str:
    out = [
        "# Review CSV columns",
        "",
        f"`review-all.csv` holds every candidate once; `review-batch-1.csv` … `review-batch-{batches}.csv` hold the same rows,",
        "each exactly once. Lists inside a cell are separated by `|` (values) or `;` (readings). UTF-8, LF line endings.",
        "",
        "## Provenance columns (filled by the pipeline; do not edit)",
        "",
        *[f"- `{column}`: {COLUMN_DOCS[column]}" for column in PROVENANCE_COLUMNS],
        "",
        "## Review columns (empty; filled by reviewers)",
        "",
        *[f"- `{column}`: {COLUMN_DOCS[column]}" for column in REVIEW_COLUMNS],
        "",
    ]
    return "\n".join(out)


def render_review(pilot_dir: Path, run_dir: Path, checklist: dict[str, Any], batches: int = 8) -> dict[str, bytes]:
    for path in (pilot_dir / "pilot-proposal.json", pilot_dir / "pilot-report.json", run_dir / "run-manifest.json", run_dir / "candidates.json"):
        if not path.is_file():
            raise OutputError(f"Missing {portable_path(path)}: expected a redistributable pilot folder and its run.")
    proposal = json.loads((pilot_dir / "pilot-proposal.json").read_text(encoding="utf-8"))
    run_manifest = json.loads((run_dir / "run-manifest.json").read_text(encoding="utf-8"))
    if proposal.get("profile") != "redistributable" or run_manifest.get("profile") != "redistributable":
        raise OutputError("The review package can only be built from redistributable data.")
    if proposal["source_run"]["candidates_sha256"] != sha256_file(run_dir / "candidates.json"):
        raise OutputError("The pilot was not built from this run (candidates checksum differs).")
    document = json.loads((run_dir / "candidates.json").read_text(encoding="utf-8"))
    records_by_id = {record["candidate_id"]: record for record in document["candidates"]}
    entries = proposal["entries"]
    rows = []
    for position, entry in enumerate(entries):
        record = records_by_id.get(entry["candidate_id"])
        if record is None:
            raise OutputError(f"{entry['candidate_id']} is in the pilot but not in the run.")
        rows.append(review_row(entry, record, batch=position % batches + 1))
    coverage = function_word_coverage(document["candidates"], {entry["candidate_id"] for entry in entries}, checklist)
    coverage_csv = io.StringIO()
    writer = csv.DictWriter(coverage_csv, fieldnames=list(coverage[0]), lineterminator="\n")
    writer.writeheader()
    writer.writerows(coverage)
    pilot_report = json.loads((pilot_dir / "pilot-report.json").read_text(encoding="utf-8"))
    rendered = {"review-all.csv": _csv(rows)}
    for batch in range(1, batches + 1):
        rendered[f"review-batch-{batch}.csv"] = _csv([row for row in rows if row["batch"] == str(batch)])
    rendered["function-word-coverage.csv"] = coverage_csv.getvalue().encode("utf-8")
    rendered["function-word-coverage.md"] = (_coverage_markdown(coverage) + "\n").encode("utf-8")
    rendered["pilot-overview.md"] = (_overview(entries, records_by_id, pilot_report, coverage) + "\n").encode("utf-8")
    rendered["COLUMNS.md"] = (_columns_markdown(batches) + "\n").encode("utf-8")
    rendered["ATTRIBUTION.md"] = (pilot_dir / "ATTRIBUTION.md").read_bytes()
    return rendered


def _same_package(out_dir: Path, pilot_dir: Path, run_dir: Path) -> bool:
    """Whether a folder holds only a review package built from this exact pilot and run (safe to regenerate)."""
    manifest_path = out_dir / "review-manifest.json"
    if not manifest_path.is_file():
        return False
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = {output["file"] for output in manifest.get("outputs", [])} | {"review-manifest.json"}
    return (
        manifest.get("format") == "vocabulary-data-review-package"
        and manifest.get("pilot_proposal_sha256") == sha256_file(pilot_dir / "pilot-proposal.json")
        and manifest.get("run_candidates_sha256") == sha256_file(run_dir / "candidates.json")
        and {path.name for path in out_dir.iterdir()} <= expected
    )


def write_review(
    pilot_dir: Path, run_dir: Path, out_dir: Path, checklist_path: Path, batches: int = 8, output_root: Path = OUTPUT_ROOT, replace: bool = False
) -> dict[str, Any]:
    require_inside(out_dir, "redistributable", output_root)
    if out_dir.exists() and any(out_dir.iterdir()) and not (replace and _same_package(out_dir, pilot_dir, run_dir)):
        raise OutputError(
            f"{portable_path(out_dir)} already contains files; choose a new folder"
            + (" (--replace only regenerates a review package of the same pilot and run)." if replace else ".")
        )
    checklist = json.loads(checklist_path.read_text(encoding="utf-8"))
    rendered = render_review(pilot_dir, run_dir, checklist, batches)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, data in rendered.items():
        (out_dir / name).write_bytes(data)
    manifest = {
        "format": "vocabulary-data-review-package",
        "version": 1,
        "profile": "redistributable",
        "executed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "pilot": portable_path(pilot_dir),
        "pilot_proposal_sha256": sha256_file(pilot_dir / "pilot-proposal.json"),
        "run": portable_path(run_dir),
        "run_candidates_sha256": sha256_file(run_dir / "candidates.json"),
        "checklist": portable_path(checklist_path),
        "checklist_sha256": sha256_file(checklist_path),
        "batches": batches,
        "outputs": [{"file": name, "sha256": sha256_bytes(data), "bytes": len(data)} for name, data in rendered.items()],
    }
    (out_dir / "review-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def validate_review(out_dir: Path, pilot_dir: Path) -> list[str]:
    """Completeness, uniqueness, traceability, empty review columns and no restricted traces."""
    problems: list[str] = []
    manifest = json.loads((out_dir / "review-manifest.json").read_text(encoding="utf-8"))
    for output in manifest["outputs"]:
        path = out_dir / output["file"]
        if not path.exists() or sha256_file(path) != output["sha256"]:
            problems.append(f"{output['file']} is missing or does not match the manifest.")
    proposal = json.loads((pilot_dir / "pilot-proposal.json").read_text(encoding="utf-8"))
    if manifest["pilot_proposal_sha256"] != sha256_file(pilot_dir / "pilot-proposal.json"):
        problems.append("The pilot proposal changed since the package was built.")
    pilot_ids = [entry["candidate_id"] for entry in proposal["entries"]]
    with (out_dir / "review-all.csv").open(encoding="utf-8", newline="") as handle:
        all_rows = list(csv.DictReader(handle))
    if [row["candidate_id"] for row in all_rows] != pilot_ids:
        problems.append("review-all.csv does not list every pilot candidate exactly once, in pilot order.")
    batch_ids: list[str] = []
    for batch in range(1, manifest["batches"] + 1):
        with (out_dir / f"review-batch-{batch}.csv").open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        if any(row["batch"] != str(batch) for row in rows):
            problems.append(f"review-batch-{batch}.csv holds rows of another batch.")
        batch_ids += [row["candidate_id"] for row in rows]
    if sorted(batch_ids) != sorted(pilot_ids) or len(set(batch_ids)) != len(batch_ids):
        problems.append("The batches lose or duplicate candidates.")
    if any(row[column] for row in all_rows for column in REVIEW_COLUMNS):
        problems.append("Review columns must start empty.")
    if not all_rows or list(all_rows[0]) != COLUMNS:
        problems.append("review-all.csv is empty or does not have the documented columns.")
    for path in sorted(out_dir.iterdir()):
        text = path.read_text(encoding="utf-8").lower()
        found = [marker for marker in RESTRICTED_MARKERS if marker in text]
        if found:
            problems.append(f"{path.name} mentions restricted sources ({', '.join(found)}).")
    return problems
