"""The quality report: what a run did, in numbers and in examples a reviewer can check.

Counts alone prove nothing about quality, so every category comes with
deterministic samples (the highest-ranked members, plus evenly spaced ones).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from .candidates import ATTENTION_FLAGS, EVIDENCE_LEVELS, Candidate
from .normalization import comparison_key
from .pipeline import PipelineResult


def _label(candidate: Candidate) -> str:
    return candidate.surface_form


def _first(items: list[Candidate], count: int) -> list[str]:
    return [_label(item) for item in items[:count]]


def _spread(items: list[Candidate], count: int) -> list[str]:
    if len(items) <= count:
        return [_label(item) for item in items]
    step = len(items) / count
    return [_label(items[int(index * step)]) for index in range(count)]


def build_report(result: PipelineResult, config: dict[str, Any], config_sha256: str, pipeline_version: str) -> dict[str, Any]:
    sample = config.get("report", {}).get("sample_size", 15)
    windows = config.get("report", {}).get("rank_windows", [5000, 10000, 20000])
    candidates = result.candidates
    retained = [item for item in candidates if item.status == "retained"]
    excluded = [item for item in candidates if item.status == "excluded"]
    folded = [item for item in candidates if item.status == "folded"]
    attention = set(ATTENTION_FLAGS)
    flagged = [item for item in retained if item.flags & attention]
    clean = [item for item in retained if not item.flags & attention]
    enabled = result.enabled_frequency_sources

    coverage = Counter()
    for item in retained:
        observed = tuple(source_id for source_id in enabled if not item.ranks[source_id].censored)
        coverage[" + ".join(observed) if observed else "none"] += 1

    disagreements = defaultdict(list)
    for item in retained:
        if item.disagreement:
            disagreements[item.disagreement["direction"]].append(item)

    # Only retained candidates: excluded number tokens ("0.0" / "00") would drown the useful cases ("cafe" / "café").
    collisions = defaultdict(list)
    for item in retained:
        collisions[comparison_key(item.normalized)].append(item.normalized)
    all_groups = sorted(sorted(group) for group in collisions.values() if len(group) > 1)
    # Groups that differ only by periods are initials ("a.a" / "aa"); they are counted, not listed.
    period_only = [group for group in all_groups if len({member.replace(".", "") for member in group}) == 1]
    collision_groups = [group for group in all_groups if group not in period_only]

    window_stats = {}
    for window in windows:
        top = [item for item in retained if item.retained_rank is not None and item.retained_rank <= window]
        window_stats[str(window)] = {
            "retained": len(top),
            "clean": sum(1 for item in top if not item.flags & attention),
            "flag_counts": {flag: sum(1 for item in top if flag in item.flags) for flag in ATTENTION_FLAGS},
            "lemma_status": dict(sorted(Counter(item.lemma_status for item in top).items())),
        }

    by_flag = {flag: [item for item in retained if flag in item.flags] for flag in sorted({flag for item in candidates for flag in item.flags})}
    by_reason = defaultdict(list)
    for item in excluded:
        for reason in item.exclusion_reasons:
            by_reason[reason].append(item)
    ambiguous = [item for item in retained if item.lemma_status == "ambiguous"]
    variant_pairs = sorted({tuple(sorted((item.normalized, variant["form"]))) for item in retained for variant in item.variants})

    by_evidence = defaultdict(list)
    for item in candidates:
        by_evidence[item.evidence_level].append(item)
    morphology = {
        "fold_basis": dict(sorted(Counter(item.fold_basis for item in folded if item.fold_basis).items())),
        "esdb_confirmed_inflections": [f"{item.normalized} -> {item.lemma}" for item in folded if item.fold_basis == "esdb_derived_form+morphy"][: sample * 2],
        "inflection_needs_review": [
            f"{item.normalized}: " + "; ".join(f"{analysis['relation']} {analysis.get('written', analysis['lemma'])} ({analysis['pos']}{', minor' if analysis.get('minor') else ''})" for analysis in item.analyses)
            for item in retained
            if "inflection_needs_review" in item.flags
        ][:sample],
        "suggestion_contradicted": [_label(item) for item in retained if "suggestion_contradicted" in item.flags][:sample],
        "pos_from_esdb": [f"{_label(item)} ({'|'.join(item.parts_of_speech)})" for item in retained if item.pos_sources == {"esdb-2026.02.25"}][:sample],
    }

    return {
        "format": "vocabulary-data-quality-report",
        "version": 1,
        "pipeline_version": pipeline_version,
        "profile": result.profile,
        "config_sha256": config_sha256,
        "sources": result.source_stats,
        "lexicon": result.lexicon_stats,
        "morphology_source": result.esdb_stats,
        "evidence_levels": {level: len(by_evidence.get(level, [])) for level in EVIDENCE_LEVELS},
        "evidence_level_samples": {level: _first(by_evidence.get(level, []), sample) for level in EVIDENCE_LEVELS},
        "morphology": morphology if result.esdb_stats else {"fold_basis": dict(sorted(Counter(item.fold_basis for item in folded if item.fold_basis).items()))},
        "pool": {"top_n_per_source": result.pool_sizes, "candidates_total": len(candidates), "added_as_lemma_of_observed_form": sum(1 for item in candidates if item.origin == "lemma_of_observed_form")},
        "candidates": {
            "total": len(candidates),
            "retained": len(retained),
            "retained_flagged": len(flagged),
            "retained_clean": len(clean),
            "excluded": len(excluded),
            "folded": len(folded),
        },
        "exclusion_reasons": dict(sorted(Counter(reason for item in excluded for reason in item.exclusion_reasons).items())),
        "flags_among_retained": dict(sorted(Counter(flag for item in retained for flag in item.flags).items())),
        "lemma_status_among_retained": dict(sorted(Counter(item.lemma_status for item in retained).items())),
        "part_of_speech_count_among_retained": dict(sorted(Counter(len(item.parts_of_speech) for item in retained).items())),
        "source_coverage_among_retained": dict(sorted(coverage.items())),
        "source_disagreement_among_retained": {direction: len(items) for direction, items in sorted(disagreements.items())},
        "possible_duplicates_by_comparison_key": {"groups": len(collision_groups), "period_only_groups": len(period_only), "examples": collision_groups[: sample * 2]},
        "rank_windows": window_stats,
        "samples": {
            "clean_top": _first(clean, sample * 2),
            "clean_spread": _spread(clean, sample * 2),
            "flagged_by_flag": {flag: {"count": len(items), "top": _first(items, sample), "spread": _spread(items, sample)} for flag, items in by_flag.items()},
            "excluded_by_reason": {reason: {"count": len(items), "top": _first(items, sample)} for reason, items in sorted(by_reason.items())},
            "folded_forms": [f"{item.normalized} -> {item.lemma}" for item in folded[: sample * 2]],
            "ambiguous_identity": [
                f"{item.normalized}: " + "; ".join(f"{analysis['relation']} {analysis.get('written', analysis['lemma'])} ({analysis['pos']})" for analysis in item.analyses)
                for item in ambiguous[:sample]
            ],
            "spelling_variant_pairs": [" / ".join(pair) for pair in variant_pairs[: sample * 2]],
            "disagreement": {direction: [f"{_label(item)} ({item.disagreement['log10_rank_ratio']})" for item in items[:sample]] for direction, items in sorted(disagreements.items())},
        },
    }


def _table(rows: list[tuple[str, Any]], headers: tuple[str, str] = ("", "Count")) -> str:
    lines = [f"| {headers[0]} | {headers[1]} |", "| --- | ---: |"]
    lines += [f"| {key} | {value} |" for key, value in rows]
    return "\n".join(lines)


def _join(values: list[str]) -> str:
    return ", ".join(values) if values else "(none)"


def render_markdown(report: dict[str, Any], distribution: str) -> str:
    counts = report["candidates"]
    out: list[str] = [
        "# Vocabulary candidate quality report",
        "",
        f"Pipeline {report['pipeline_version']} · profile **{report['profile']}** · configuration sha256 `{report['config_sha256'][:12]}…` · distribution: **{distribution}** (see ATTRIBUTION.md).",
        "",
        "This report describes candidates, not a finished catalogue. Counts are not evidence of quality; read the samples.",
        "No candidate is linguistically verified: \"automatically confirmed\" only means a source lists the spelling as a",
        "dictionary form (or an explicit form of one) with a single reading and no attention flag was raised.",
        "",
        "## Sources",
        "",
    ]
    for source, stats in report["sources"].items():
        out.append(f"- **{source}**: " + ", ".join(f"{key.replace('_', ' ')} {value}" for key, value in stats.items()))
    if report["lexicon"]:
        out.append("- **oewn-2025 (lexicon)**: " + ", ".join(f"{key.replace('_', ' ')} {value}" for key, value in report["lexicon"].items()))
    if report["morphology_source"]:
        out.append("- **esdb-2026.02.25 (morphology)**: " + ", ".join(f"{key.replace('_', ' ')} {value}" for key, value in report["morphology_source"].items()))
    levels = report["evidence_levels"]
    descriptions = {
        "automatically_confirmed": "a source establishes the dictionary form, one reading, no attention flag",
        "source_confirmed_needs_review": "a source establishes the dictionary form, but a flag needs a human look",
        "ambiguous": "several readings (lemma and form, several lemmas, ...)",
        "no_evidence": "no source establishes a dictionary form",
        "excluded": "non-lexical token, with an explicit reason",
    }
    out += [
        "",
        "## Evidence levels (all candidates)",
        "",
        "| Level | Candidates | Meaning | Examples |",
        "| --- | ---: | --- | --- |",
        *[f"| {level} | {levels[level]} | {descriptions[level]} | {_join(report['evidence_level_samples'][level][:8])} |" for level in levels],
        "",
        "Folded forms count as automatically confirmed (an explicit form-of relation). Fold basis: "
        + (", ".join(f"{key}: {value}" for key, value in report["morphology"]["fold_basis"].items()) or "none"),
    ]
    if report["morphology_source"]:
        morphology = report["morphology"]
        out += [
            "",
            "### Morphology evidence (restricted: ESDB)",
            "",
            f"**Regular forms confirmed by ESDB and WordNet's rules, folded:** {_join(morphology['esdb_confirmed_inflections'])}",
            "",
            "**Forms ESDB relates to a lemma, kept for review:**",
            "",
            *[f"- {line}" for line in morphology["inflection_needs_review"]],
            "",
            f"**WordNet-rule suggestions contradicted by ESDB (word kept as a lemma):** {_join(morphology['suggestion_contradicted'])}",
            "",
            f"**Parts of speech only ESDB provides (function words, contractions):** {_join(morphology['pos_from_esdb'])}",
        ]
    out += [
        "",
        "## Candidates",
        "",
        _table(
            [
                ("Total candidates", counts["total"]),
                ("Retained", counts["retained"]),
                ("… of which flagged for review", counts["retained_flagged"]),
                ("… of which clean (no attention flag)", counts["retained_clean"]),
                ("Excluded (non-lexical, with reasons)", counts["excluded"]),
                ("Folded into their lemma (confirmed forms; see fold basis)", counts["folded"]),
                ("Added as the lemma of an observed form", report["pool"]["added_as_lemma_of_observed_form"]),
            ]
        ),
        "",
        "### Exclusion reasons",
        "",
        _table(list(report["exclusion_reasons"].items()), ("Reason", "Candidates")),
        "",
        "### Flags among retained candidates",
        "",
        _table(list(report["flags_among_retained"].items()), ("Flag", "Candidates")),
        "",
        "### Lexical identity among retained candidates",
        "",
        _table(list(report["lemma_status_among_retained"].items()), ("Lemma status", "Candidates")),
        "",
        "Parts of speech per spelling (0 = not in the lexicon): " + ", ".join(f"{key}: {value}" for key, value in report["part_of_speech_count_among_retained"].items()),
        "",
        "### Source coverage and disagreement (retained)",
        "",
        _table(list(report["source_coverage_among_retained"].items()), ("Observed in", "Candidates")),
        "",
        "Disagreement (rank ratio ≥ 10×): " + (", ".join(f"{key}: {value}" for key, value in report["source_disagreement_among_retained"].items()) or "none"),
        "",
        "### Top of the ranking",
        "",
        "| Top N retained | Clean | " + " | ".join(ATTENTION_FLAGS) + " |",
        "| ---: | ---: | " + " | ".join("---:" for _ in ATTENTION_FLAGS) + " |",
    ]
    for window, stats in report["rank_windows"].items():
        out.append(f"| {window} | {stats['clean']} | " + " | ".join(str(stats["flag_counts"][flag]) for flag in ATTENTION_FLAGS) + " |")
    samples = report["samples"]
    out += [
        "",
        "## Samples",
        "",
        f"**Clean, highest ranked:** {_join(samples['clean_top'])}",
        "",
        f"**Clean, evenly spaced through the ranking:** {_join(samples['clean_spread'])}",
        "",
        "### Flagged (retained)",
        "",
    ]
    for flag, data in samples["flagged_by_flag"].items():
        out.append(f"- **{flag}** ({data['count']}): top: {_join(data['top'])}; spread: {_join(data['spread'])}")
    out += ["", "### Excluded", ""]
    for reason, data in samples["excluded_by_reason"].items():
        out.append(f"- **{reason}** ({data['count']}): {_join(data['top'])}")
    out += [
        "",
        f"**Folded irregular forms:** {_join(samples['folded_forms'])}",
        "",
        "**Ambiguous lexical identity:**",
        "",
        *[f"- {line}" for line in samples["ambiguous_identity"]],
        "",
        f"**Spelling-variant pairs:** {_join(samples['spelling_variant_pairs'])}",
        "",
    ]
    for direction, items in samples["disagreement"].items():
        out.append(f"**Disagreement, {direction}:** {_join(items)}")
        out.append("")
    dupes = report["possible_duplicates_by_comparison_key"]
    out += [
        f"**Possible duplicates by comparison key** ({dupes['groups']} groups differing by accents, apostrophes or hyphens, plus {dupes['period_only_groups']} differing only by periods; none merged): "
        + _join([" / ".join(group) for group in dupes["examples"]]),
        "",
    ]
    return "\n".join(out)
