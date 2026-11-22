"""One pipeline run: verify inputs, load enabled sources, build candidates.

No network access happens here. Inputs must already be in raw/ (or installed,
for wordfreq) and match the checksums pinned in the source register.

Profile isolation: a source's loader is only called when the source is enabled
*and* allowed in the run's profile, so the redistributable profile never
imports wordfreq or opens the ESDB database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .adapters import CaseEvidence, FrequencySource, case_evidence, load_wordfreq, rank_list, read_lines
from .candidates import BuildInputs, Candidate, build_candidates
from .esdb import Esdb, load_esdb
from .fetch import source_dir, verify_source
from .lexicon import Lexicon, load_lexicon
from .manifest import ESDB, GOOGLE, OEWN, WORDFREQ, ManifestError, SourceRegister, enabled_sources


@dataclass
class Loaders:
    """How each source is read; tests replace these with in-memory fixtures."""

    google: Callable[[dict[str, Any], Path], tuple[FrequencySource, dict[str, CaseEvidence], dict[str, int]]]
    wordfreq: Callable[[dict[str, Any]], FrequencySource]
    lexicon: Callable[[dict[str, Any], Path], Lexicon]
    esdb: Callable[[dict[str, Any], Path], Esdb] | None = None


def _load_google(settings: dict[str, Any], directory: Path) -> tuple[FrequencySource, dict[str, CaseEvidence], dict[str, int]]:
    ranked = rank_list(GOOGLE, read_lines(directory / settings["lower_file"]))
    case, case_stats = case_evidence(read_lines(directory / settings["mixed_file"]))
    return ranked, case, case_stats


def default_loaders(register: SourceRegister) -> Loaders:
    database_name = register.sources[ESDB]["database"]["name"] if ESDB in register.sources else "scowl.db"
    return Loaders(
        google=_load_google,
        wordfreq=lambda settings: load_wordfreq(WORDFREQ, settings.get("wordlist", "large")),
        lexicon=lambda settings, directory: load_lexicon(directory / settings["file"], OEWN),
        esdb=lambda _settings, directory: load_esdb(directory / database_name, ESDB),
    )


@dataclass
class PipelineResult:
    profile: str
    candidates: list[Candidate]
    enabled_frequency_sources: list[str]
    used_sources: list[dict[str, Any]]
    source_stats: dict[str, dict[str, int]]
    lexicon_stats: dict[str, int] | None
    esdb_stats: dict[str, int] | None
    pool_sizes: dict[str, int]
    inputs: list[dict[str, Any]] = field(default_factory=list)


def run_pipeline(config: dict[str, Any], register: SourceRegister, raw_dir: Path, *, loaders: Loaders | None = None, verify_inputs: bool = True) -> PipelineResult:
    profile = config["profile"]
    settings = config["sources"]
    enabled = enabled_sources(config)
    # Checked again here (not only when the config is loaded): nothing outside the profile is ever read.
    used_sources = [register.usable(source_id, profile) for source_id in enabled]
    if profile == "redistributable" and any(source["status"] != "approved" or source["distribution"] != "attribution" for source in used_sources):
        raise ManifestError("The redistributable profile may only use approved sources with distribution 'attribution'.")
    loaders = loaders or default_loaders(register)
    inputs: list[dict[str, Any]] = []
    if verify_inputs:
        for source_id in enabled:
            inputs.extend(verify_source(register, source_id, raw_dir))

    frequency_sources: dict[str, FrequencySource] = {}
    source_stats: dict[str, dict[str, int]] = {}
    case: dict[str, CaseEvidence] | None = None
    if GOOGLE in enabled:
        ranked, case, case_stats = loaders.google(settings[GOOGLE], source_dir(raw_dir, GOOGLE))
        frequency_sources[GOOGLE] = ranked
        source_stats[f"{GOOGLE} (lower-case list)"] = ranked.stats
        source_stats[f"{GOOGLE} (mixed-case list)"] = case_stats
    if WORDFREQ in enabled:
        frequency_sources[WORDFREQ] = loaders.wordfreq(settings[WORDFREQ])
        source_stats[WORDFREQ] = frequency_sources[WORDFREQ].stats
    lexicon = loaders.lexicon(settings[OEWN], source_dir(raw_dir, OEWN)) if OEWN in enabled else None
    esdb = None
    if ESDB in enabled:
        if loaders.esdb is None:
            raise ManifestError(f"{ESDB} is enabled but no loader is available.")
        esdb = loaders.esdb(settings[ESDB], source_dir(raw_dir, ESDB))

    pool_sizes = {source_id: settings[source_id]["pool_top_n"] for source_id in frequency_sources}
    candidates = build_candidates(BuildInputs(frequency_sources=frequency_sources, pool_sizes=pool_sizes, case=case, lexicon=lexicon, config=config, esdb=esdb))
    return PipelineResult(
        profile=profile,
        candidates=candidates,
        enabled_frequency_sources=sorted(frequency_sources),
        used_sources=used_sources,
        source_stats=source_stats,
        lexicon_stats=lexicon.stats if lexicon else None,
        esdb_stats=esdb.stats if esdb else None,
        pool_sizes=pool_sizes,
        inputs=inputs,
    )
