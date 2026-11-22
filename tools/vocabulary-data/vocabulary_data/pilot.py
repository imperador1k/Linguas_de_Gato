"""The enrichment-pilot proposal: a stratified, traceable selection for human review.

Only a redistributable run can be the input. Nothing is generated about the
words themselves (no translations, definitions, sentences, CEFR levels,
topics or accepted answers): the proposal is a list of candidates with their
evidence, and every entry is "pending_human_review".

Selection (deterministic, configured in the profile's "pilot" section):
- systematic sampling (evenly spaced picks) inside each group and rank band,
  so the proposal spans the frequency range instead of taking the top rows;
- groups: core dictionary forms by rank band; lemmas with explicit irregular
  forms; British/American spelling pairs (both members); and a review group of
  valuable but flagged words (months and nationalities, acronyms, words that are
  also names, explicitly ambiguous forms);
- never included: unverified inflections, words without lexical evidence,
  likely names, abbreviations, possible foreign tokens, and candidates with
  potential false-positive signals (reported separately).

A smaller proposal than requested is reported, never padded.
"""

from __future__ import annotations

import csv
import io
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .candidates import EMPTY_ENRICHMENT
from .manifest import GOOGLE, OUTPUT_ROOT, sha256_bytes, sha256_file
from .outputs import OutputError, portable_path, require_inside, validate_run

PILOT_OUTPUTS = ("pilot-proposal.json", "pilot-proposal.csv", "pilot-report.json", "pilot-report.md", "ATTRIBUTION.md")
NEVER_IN_PILOT = ("possible_regular_inflection", "inflection_needs_review", "proper_name_likely", "abbreviation", "possible_foreign_token", "possible_roman_numeral", "possible_accent_variant")
EXPLICIT_RELATIONS = {"is_lemma", "explicit_form"}


def _systematic(items: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    """Evenly spaced picks over an ordered list (deterministic); all of them when there are fewer."""
    if count <= 0:
        return []
    if len(items) <= count:
        return list(items)
    return [items[int((index + 0.5) * len(items) / count)] for index in range(count)]


def _rank(record: dict[str, Any]) -> int:
    frequency = record["frequency"][GOOGLE]
    grouped = frequency.get("with_folded_forms")
    return grouped["rank"] if grouped else frequency["rank"]


def false_positive_signals(record: dict[str, Any]) -> list[str]:
    """Reasons to doubt a lexicon match even when no flag was raised (reported; never silently dropped)."""
    signals = []
    form = record["normalized_form"]
    lexicon_spellings = record.get("lexicon_lemmas", [])
    pattern = (record.get("capitalization") or {}).get("pattern")
    if lexicon_spellings and all(spelling != form for spelling in lexicon_spellings) and pattern not in {"capitalized", "upper", "mixed"}:
        # The lexicon only has a capitalised or upper-case entry ("LAN", "Lu") but the text mostly uses lower case
        # ("lan", "lu"): the match may be a different word. (DNA or February match their own capitalisation: no signal.)
        signals.append("lexicon_match_by_case_only")
    if len(form) == 1:
        signals.append("single_letter")
    return signals


def _band_label(rank: int, bands: list[int]) -> str:
    lower = 1
    for upper in bands:
        if rank <= upper:
            return f"{lower}-{upper}"
        lower = upper + 1
    return f">{bands[-1]}"


def build_proposal(document: dict[str, Any], pilot_config: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records = document["candidates"]
    retained = [record for record in records if record["candidate_status"] == "retained"]
    bands = pilot_config["rank_bands"]

    # Why retained candidates cannot enter the pilot (a candidate is counted under its first reason).
    exclusion_reasons: Counter[str] = Counter()
    eligible: list[dict[str, Any]] = []
    potential_false_positives: list[dict[str, Any]] = []
    for record in retained:
        flags = set(record["flags"])
        blocking = [flag for flag in NEVER_IN_PILOT if flag in flags]
        if record["evidence_level"] == "no_evidence":
            exclusion_reasons["no lexical evidence (not in the approved lexicon)"] += 1
        elif blocking:
            exclusion_reasons[f"flag: {blocking[0]}"] += 1
        elif _rank(record) > bands[-1]:
            exclusion_reasons["outside the rank bands"] += 1
        elif false_positive_signals(record):
            potential_false_positives.append(record)
            exclusion_reasons["potential false positive"] += 1
        else:
            eligible.append(record)
    eligible.sort(key=lambda record: (_rank(record), record["candidate_id"]))
    by_id = {record["candidate_id"]: record for record in eligible}

    selected: list[tuple[dict[str, Any], str, str]] = []
    taken: set[str] = set()
    shortfalls: dict[str, dict[str, int]] = {}

    def take(group: str, pool: list[dict[str, Any]], count: int, reason: str) -> None:
        pool = [record for record in pool if record["candidate_id"] not in taken]
        picks = _systematic(pool, count)
        if len(picks) < count:
            shortfalls[group] = {"requested": count, "available": len(picks)}
        for record in picks:
            taken.add(record["candidate_id"])
            selected.append((record, group, reason))

    # 1. British/American spelling pairs: both members, linked.
    pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for record in eligible:
        for variant in record["spelling_variants"]:
            partner = by_id.get(f"en:{variant['form']}")
            key = tuple(sorted((record["candidate_id"], f"en:{variant['form']}")))
            if partner is not None and key not in seen_pairs and record["lemma_status"] == partner["lemma_status"] == "lemma":
                seen_pairs.add(key)
                pairs.append((record, partner))
    wanted_pairs = pilot_config["variant_pairs"]
    # Pairs are in rank order (built from the sorted eligible list), so the picks span the frequency range.
    for item in _systematic([{"pair": pair, "candidate_id": pair[0]["candidate_id"]} for pair in pairs], wanted_pairs):
        first, second = item["pair"]
        for member, other in ((first, second), (second, first)):
            if member["candidate_id"] not in taken:
                taken.add(member["candidate_id"])
                selected.append((member, "spelling_variant_pair", f"spelling variant of {other['surface_form']} (Open English WordNet spelling markers)"))
    if len(pairs) < wanted_pairs:
        shortfalls["spelling_variant_pair"] = {"requested": wanted_pairs, "available": len(pairs)}

    # 2. Lemmas with explicit irregular forms (children -> child, went -> go).
    irregular = [record for record in eligible if record["folded_forms"] and record["lemma_status"] == "lemma"]
    take("irregular_lemma", irregular, pilot_config["irregular"], "dictionary form with explicit irregular forms")

    # 3. Valuable but flagged words, for an explicit review group. Capped by rank: deep in the book list these
    #    groups are mostly obscure names and acronyms rather than useful flagged words.
    review = pilot_config["review"]
    review_cap = pilot_config.get("review_max_rank")
    review_eligible = [record for record in eligible if review_cap is None or _rank(record) <= review_cap]
    review_pools = {
        "capitalized_ordinary_word": [record for record in review_eligible if "capitalized_ordinary_word" in record["flags"]],
        "acronym_likely": [record for record in review_eligible if "acronym_likely" in record["flags"] and record["lemma_status"] == "lemma"],
        "capitalization_ambiguous": [record for record in review_eligible if "capitalization_ambiguous" in record["flags"] and record["lemma_status"] == "lemma"],
        "ambiguous_explicit": [
            record for record in review_eligible if record["lemma_status"] == "ambiguous" and {item["relation"] for item in record["lemma_analyses"]} <= EXPLICIT_RELATIONS
        ],
    }
    reasons = {
        "capitalized_ordinary_word": "capitalised ordinary vocabulary (month, day, language or nationality): check meaning and capitalisation",
        "acronym_likely": "acronym that is also a dictionary entry: check whether it is learner vocabulary",
        "capitalization_ambiguous": "common word that is also a name: check which reading is meant",
        "ambiguous_explicit": "several explicit readings (a dictionary form and a form of another word): decide the entry",
    }
    for name, pool in review_pools.items():
        take(f"review:{name}", pool, review[name], reasons[name])

    # 4. Core dictionary forms, stratified by rank band.
    core_pool = [record for record in eligible if record["evidence_level"] == "automatically_confirmed" and record["lemma_status"] == "lemma"]
    lower = 0
    for upper, count in zip(bands, pilot_config["core_per_band"]):
        band = [record for record in core_pool if lower < _rank(record) <= upper]
        take(f"core:{lower + 1}-{upper}", band, count, f"dictionary form confirmed by Open English WordNet, rank band {lower + 1}-{upper}")
        lower = upper

    entries = []
    for index, (record, group, reason) in enumerate(sorted(selected, key=lambda item: (_rank(item[0]), item[0]["candidate_id"])), start=1):
        frequency = record["frequency"][GOOGLE]
        entries.append(
            {
                "pilot_index": index,
                "candidate_id": record["candidate_id"],
                "surface_form": record["surface_form"],
                "proposed_dictionary_form": record["lemma"],
                "dictionary_form_status": record["lemma_status"],
                "dictionary_form_options": sorted({f"{item['lemma']} ({item['pos']}, {item['relation']})" for item in record["lemma_analyses"]}),
                "part_of_speech": record["part_of_speech"],
                "part_of_speech_status": record["part_of_speech_status"],
                "source_rank": {"source": GOOGLE, "rank": frequency["rank"], "rank_censored": frequency["rank_censored"], "rank_with_folded_forms": (frequency.get("with_folded_forms") or {}).get("rank")},
                "rank_band": _band_label(_rank(record), bands),
                "pilot_group": group,
                "inclusion_reason": reason,
                "evidence_level": record["evidence_level"],
                "morphology_evidence": record["lemma_analyses"],
                "folded_forms": record["folded_forms"],
                "spelling_variants": record["spelling_variants"],
                "flags": record["flags"],
                "potential_false_positive_signals": false_positive_signals(record),
                "review_status": "pending_human_review",
                "licensing": {
                    "status": "redistributable_with_attribution_per_source",
                    "sources": document["sources"],
                    "note": "Each source keeps its own licence and attribution; no single licence is claimed for the combination.",
                },
                "enrichment": dict(EMPTY_ENRICHMENT),
            }
        )
    context = {
        "eligible": len(eligible),
        "retained": len(retained),
        "exclusion_reasons": dict(sorted(exclusion_reasons.items())),
        "potential_false_positives": [f"{record['surface_form']} ({', '.join(false_positive_signals(record))}; lexicon: {', '.join(record['lexicon_lemmas'])})" for record in potential_false_positives],
        "shortfalls": shortfalls,
        "records": records,
    }
    return entries, context


def _report(entries: list[dict[str, Any]], context: dict[str, Any], document: dict[str, Any], requested: int) -> dict[str, Any]:
    records = context["records"]
    pos_counts = Counter(pos for entry in entries for pos in entry["part_of_speech"])
    high_rank_no_evidence = [record["surface_form"] for record in records if record["candidate_status"] == "retained" and record["evidence_level"] == "no_evidence" and _rank(record) <= 1000]
    groups = Counter(entry["pilot_group"].split(":")[0] for entry in entries)
    return {
        "format": "vocabulary-data-pilot-report",
        "version": 1,
        "pipeline_version": document["pipeline_version"],
        "source_run_config_sha256": document["config_sha256"],
        "requested_entries": requested,
        "proposed_entries": len(entries),
        "by_group": dict(sorted(Counter(entry["pilot_group"] for entry in entries).items())),
        "by_group_family": dict(sorted(groups.items())),
        "by_rank_band": dict(sorted(Counter(entry["rank_band"] for entry in entries).items(), key=lambda item: int(item[0].split("-")[0].lstrip(">")))),
        "by_part_of_speech": dict(sorted(pos_counts.items())),
        "multi_part_of_speech_entries": sum(1 for entry in entries if len(entry["part_of_speech"]) > 1),
        "no_part_of_speech_entries": sum(1 for entry in entries if not entry["part_of_speech"]),
        "dictionary_form_confirmed": sum(1 for entry in entries if entry["dictionary_form_status"] in {"lemma", "inflected_form"}),
        "requiring_review_beyond_the_default": sum(1 for entry in entries if entry["pilot_group"].startswith("review:") or entry["evidence_level"] != "automatically_confirmed"),
        "ambiguous_entries": sum(1 for entry in entries if entry["dictionary_form_status"] == "ambiguous"),
        "irregular_lemmas": sum(1 for entry in entries if entry["folded_forms"]),
        "spelling_variant_entries": sum(1 for entry in entries if entry["pilot_group"] == "spelling_variant_pair"),
        "eligible_pool": context["eligible"],
        "retained_candidates": context["retained"],
        "excluded_from_pilot": context["exclusion_reasons"],
        "potential_false_positives": {"count": len(context["potential_false_positives"]), "examples": context["potential_false_positives"][:30]},
        "shortfalls": context["shortfalls"],
        "licensing": {
            "status": "redistributable_with_attribution_per_source",
            "sources": [{"id": source["id"], "licence": source["licence"], "version": source["version"]} for source in document["sources"]],
        },
        "coverage_gaps": {
            "high_frequency_words_without_lexical_evidence (rank <= 1000)": {"count": len(high_rank_no_evidence), "examples": high_rank_no_evidence[:40]},
            "notes": [
                "Function words (the, of, which, would) have no part of speech in the approved lexicon and are not in the proposal.",
                "Regular inflections are not confirmed by an approved source; forms such as 'books' are excluded, not merged.",
                "No multiword expressions or phrasal verbs: neither approved source provides them with frequency evidence.",
                "Ranks come from printed books (1950-2008): everyday and recent vocabulary is under-ranked or missing.",
                "Likely names and abbreviations are excluded; capitalised ordinary words and acronyms appear only in the review group.",
            ],
        },
        "samples": {group: [entry["surface_form"] for entry in entries if entry["pilot_group"] == group][:8] for group in sorted({entry["pilot_group"] for entry in entries})},
    }


def _markdown(report: dict[str, Any]) -> str:
    def table(rows: dict[str, Any], header: str) -> list[str]:
        return [f"| {header} | Entries |", "| --- | ---: |", *[f"| {key} | {value} |" for key, value in rows.items()]]

    out = [
        "# Enrichment pilot proposal",
        "",
        f"**{report['proposed_entries']} entries proposed** (requested {report['requested_entries']}) from a redistributable run (pipeline {report['pipeline_version']}, configuration `{report['source_run_config_sha256'][:12]}…`).",
        "",
        "This is a selection proposal for human review, **not production-ready content**. No translation, definition, example, CEFR level,",
        "topic or accepted answer was generated. Every entry is `pending_human_review`.",
        "",
        "## Composition",
        "",
        *table(report["by_group"], "Group"),
        "",
        *table(report["by_rank_band"], "Rank band (Google Books)"),
        "",
        *table(report["by_part_of_speech"], "Part of speech (an entry can have several)"),
        "",
        f"- Entries with several parts of speech: {report['multi_part_of_speech_entries']}; without a part of speech: {report['no_part_of_speech_entries']}.",
        f"- Dictionary form confirmed by the approved lexicon: {report['dictionary_form_confirmed']}; ambiguous: {report['ambiguous_entries']}.",
        f"- Lemmas with explicit irregular forms: {report['irregular_lemmas']}; spelling-variant entries: {report['spelling_variant_entries']}.",
        f"- Entries needing review beyond the default check (review group or flagged): {report['requiring_review_beyond_the_default']}.",
        "",
        "## What was left out, and why",
        "",
        f"Eligible pool: {report['eligible_pool']} of {report['retained_candidates']} retained candidates.",
        "",
        *table(report["excluded_from_pilot"], "Reason (first reason per candidate)"),
        "",
        f"**Potential false positives** ({report['potential_false_positives']['count']}, not proposed): "
        + ", ".join(report["potential_false_positives"]["examples"]),
        "",
    ]
    if report["shortfalls"]:
        out += ["**Shortfalls (fewer available than requested):** " + ", ".join(f"{group}: {value['available']} of {value['requested']}" for group, value in report["shortfalls"].items()), ""]
    gaps = report["coverage_gaps"]
    first_gap = next(iter(gaps))
    out += [
        "## Coverage gaps",
        "",
        f"- {first_gap}: {gaps[first_gap]['count']} — {', '.join(gaps[first_gap]['examples'])}",
        *[f"- {note}" for note in gaps["notes"]],
        "",
        "## Licensing",
        "",
        *[f"- `{source['id']}` — {source['licence']} ({source['version']})" for source in report["licensing"]["sources"]],
        "",
        "Each source keeps its own licence and attribution (see ATTRIBUTION.md); no single licence is claimed for the combination.",
        "",
        "## Samples",
        "",
        *[f"- **{group}**: {', '.join(words)}" for group, words in report["samples"].items()],
        "",
    ]
    return "\n".join(out)


def _csv(entries: list[dict[str, Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(
        [
            "pilot_index", "candidate_id", "surface_form", "proposed_dictionary_form", "dictionary_form_status", "dictionary_form_options",
            "part_of_speech", "part_of_speech_status", "source", "source_rank", "rank_with_folded_forms", "rank_band", "pilot_group",
            "inclusion_reason", "evidence_level", "folded_forms", "spelling_variants", "flags", "potential_false_positive_signals",
            "review_status", "licensing_status",
        ]
    )
    for entry in entries:
        writer.writerow(
            [
                entry["pilot_index"], entry["candidate_id"], entry["surface_form"], entry["proposed_dictionary_form"] or "", entry["dictionary_form_status"],
                "|".join(entry["dictionary_form_options"]), "|".join(entry["part_of_speech"]), entry["part_of_speech_status"], entry["source_rank"]["source"],
                entry["source_rank"]["rank"], entry["source_rank"]["rank_with_folded_forms"] or "", entry["rank_band"], entry["pilot_group"],
                entry["inclusion_reason"], entry["evidence_level"], "|".join(entry["folded_forms"]),
                "|".join(f"{variant['form']}/{variant['variety']}" for variant in entry["spelling_variants"]), "|".join(entry["flags"]),
                "|".join(entry["potential_false_positive_signals"]), entry["review_status"], entry["licensing"]["status"],
            ]
        )
    return buffer.getvalue()


def render_pilot(run_dir: Path, pilot_config: dict[str, Any]) -> dict[str, bytes]:
    if not (run_dir / "run-manifest.json").is_file():
        raise OutputError(f"{portable_path(run_dir)} is not a pipeline run folder (no run-manifest.json).")
    manifest = json.loads((run_dir / "run-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("profile") != "redistributable" or manifest.get("distribution") != "attribution":
        raise OutputError("The pilot proposal can only be built from a redistributable run.")
    problems = validate_run(run_dir)
    if problems:
        raise OutputError("The source run does not validate: " + "; ".join(problems[:5]))
    document = json.loads((run_dir / "candidates.json").read_text(encoding="utf-8"))
    entries, context = build_proposal(document, pilot_config)
    requested = sum(pilot_config["core_per_band"]) + pilot_config["irregular"] + 2 * pilot_config["variant_pairs"] + sum(pilot_config["review"].values())
    report = _report(entries, context, document, requested)
    settings = json.dumps(pilot_config, sort_keys=True, ensure_ascii=False)
    report["pilot_settings"] = pilot_config
    report["pilot_settings_sha256"] = sha256_bytes(settings.encode("utf-8"))
    proposal = {
        "format": "vocabulary-data-pilot-proposal",
        "version": 1,
        "pipeline_version": document["pipeline_version"],
        "profile": "redistributable",
        "source_run": {"config_sha256": document["config_sha256"], "candidates_sha256": sha256_file(run_dir / "candidates.json")},
        # The exact selection settings used (they live in the configuration's "pilot" section).
        "pilot_settings": pilot_config,
        "pilot_settings_sha256": report["pilot_settings_sha256"],
        "status": "proposal_for_human_review",
        "entry_count": len(entries),
        "entries": entries,
    }
    return {
        "pilot-proposal.json": (json.dumps(proposal, ensure_ascii=False, indent=1) + "\n").encode("utf-8"),
        "pilot-proposal.csv": _csv(entries).encode("utf-8"),
        "pilot-report.json": (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        "pilot-report.md": (_markdown(report) + "\n").encode("utf-8"),
        "ATTRIBUTION.md": (run_dir / "ATTRIBUTION.md").read_bytes(),
    }


def write_pilot(run_dir: Path, out_dir: Path, pilot_config: dict[str, Any], output_root: Path = OUTPUT_ROOT) -> dict[str, Any]:
    require_inside(out_dir, "redistributable", output_root)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise OutputError(f"{portable_path(out_dir)} already contains files; choose a new folder.")
    rendered = render_pilot(run_dir, pilot_config)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, data in rendered.items():
        (out_dir / name).write_bytes(data)
    manifest = {
        "format": "vocabulary-data-pilot-run",
        "version": 1,
        "profile": "redistributable",
        "executed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source_run": portable_path(run_dir),
        "source_run_manifest_sha256": sha256_file(run_dir / "run-manifest.json"),
        "outputs": [{"file": name, "sha256": sha256_bytes(data), "bytes": len(data)} for name, data in rendered.items()],
    }
    (out_dir / "pilot-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest
