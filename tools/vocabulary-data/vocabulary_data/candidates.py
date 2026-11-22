"""Candidate building: lexical identity, quality flags, exclusions and folding.

Principles:
- One candidate per normalised spelling. A spelling with several parts of
  speech ("book": noun and verb) keeps them all; splitting into learner
  entries (lemma + part of speech + sense) is a later, reviewed step.
- A lemma is only *set* when an explicit lexical source establishes it:
  the spelling is an Open English WordNet lemma, or it is listed there as an
  irregular form of exactly one lemma ("children" -> "child"). Suffix rules
  only ever produce a "possible_regular_inflection" flag, never a lemma.
- In the restricted profile, ESDB adds explicit morphology: a regular form is
  confirmed (and folded) only when ESDB lists it as a form of exactly one
  lemma, WordNet's rules give that same lemma, and neither source lists the
  form as a word in its own right. Everything else stays ambiguous.
- Nothing questionable is deleted silently. Excluded and folded candidates
  stay in the output with machine-readable reasons; flags never exclude.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

from .adapters import CaseEvidence, FrequencySource, zipf
from .esdb import Esdb
from .lexicon import Lexicon
from .normalization import character_profile, strip_accents
from .ranking import SourceRank, disagreement, ordering_key, source_rank

GOOGLE = "google-books-top-wordlists"
WORDFREQ = "wordfreq"

CANDIDATE_STATUSES = ("retained", "excluded", "folded")
LEMMA_STATUSES = ("lemma", "inflected_form", "ambiguous", "unresolved")
CANDIDATE_KINDS = ("word", "inflected_form", "non_lexical_token")
EXCLUSION_REASONS = ("contains_digit", "initial", "non_letter_symbol", "single_letter", "roman_numeral", "ocr_artefact", "clitic_fragment", "possessive_form")
# Flags that mean "a human should look at this before it becomes a learner entry".
ATTENTION_FLAGS = (
    "proper_name_likely",
    "acronym_likely",
    "abbreviation",
    "capitalization_ambiguous",
    "possible_foreign_token",
    "possible_roman_numeral",
    "possible_regular_inflection",
    "inflection_needs_review",
    "possible_accent_variant",
    "not_in_oewn",
    "low_frequency",
    "single_source",
)
_INITIAL = re.compile(r"^[a-z]\.$")
ALL_FLAGS = ATTENTION_FLAGS + (
    "capitalized_ordinary_word",
    "irregular_form",
    "esdb_confirmed_inflection",
    "suggestion_contradicted",
    "spelling_variant",
    "contains_apostrophe",
    "contains_hyphen",
    "non_ascii_letters",
    "frequency_disagreement_books_higher",
    "frequency_disagreement_everyday_higher",
)

# What the evidence establishes about a candidate's identity (never "linguistically verified"):
# - automatically_confirmed: a source lists the spelling as a dictionary form (or an explicit form of
#   one) with a single reading, and no attention flag is raised;
# - source_confirmed_needs_review: the same, but an attention flag needs a human look;
# - ambiguous: several readings; - no_evidence: no source establishes a dictionary form;
# - excluded: non-lexical token, with its reason.
EVIDENCE_LEVELS = ("automatically_confirmed", "source_confirmed_needs_review", "ambiguous", "no_evidence", "excluded")

EMPTY_ENRICHMENT = {
    "status": "not_started",
    "senses": None,
    "translations_pt_pt": None,
    "definition_en": None,
    "contexts": None,
    "accepted_answers": None,
    "topics": None,
    "cefr": None,
}


@dataclass
class Candidate:
    normalized: str
    origin: str
    surfaces: set[str] = field(default_factory=set)
    ranks: dict[str, SourceRank] = field(default_factory=dict)
    status: str = "retained"
    kind: str = "word"
    exclusion_reasons: list[str] = field(default_factory=list)
    flags: set[str] = field(default_factory=set)
    lemma: str | None = None
    lemma_status: str = "unresolved"
    analyses: list[dict[str, str]] = field(default_factory=list)
    parts_of_speech: list[str] = field(default_factory=list)
    lexfiles: list[str] = field(default_factory=list)
    lexicon_lemmas: list[str] = field(default_factory=list)
    variants: list[dict[str, str]] = field(default_factory=list)
    capitalization: dict[str, Any] = field(default_factory=dict)
    disagreement: dict[str, Any] | None = None
    folded_into: str | None = None
    folded_forms: list[str] = field(default_factory=list)
    # Which explicit evidence established an inflected form ("oewn_explicit_form", "esdb_derived_form+morphy").
    fold_basis: str | None = None
    # Sources the parts of speech come from.
    pos_sources: set[str] = field(default_factory=set)
    # Ranks of the lemma together with its folded forms (only when forms were folded into it).
    aggregated: dict[str, SourceRank] = field(default_factory=dict)
    combined_rank: int = 0
    retained_rank: int | None = None
    evidence_level: str = "no_evidence"

    @property
    def candidate_id(self) -> str:
        return f"en:{self.normalized}"

    @property
    def surface_form(self) -> str:
        """The spelling to show: the dominant capitalisation when it clearly dominates, else the normalised form."""
        preferred = self.capitalization.get("preferred_surface")
        return preferred or self.normalized


@dataclass
class BuildInputs:
    frequency_sources: dict[str, FrequencySource]
    pool_sizes: dict[str, int]
    case: dict[str, CaseEvidence] | None
    lexicon: Lexicon | None
    config: dict[str, Any]
    esdb: Esdb | None = None


def _capitalization(candidate: Candidate, evidence: CaseEvidence | None, flags_config: dict[str, Any]) -> None:
    if evidence is None:
        candidate.capitalization = {"pattern": "unknown", "evidence": None}
        return
    dominant = evidence.dominant()
    capitalized = evidence.ratio("capitalized")
    upper = evidence.ratio("upper")
    preferred = None
    if dominant in {"capitalized", "upper"}:
        ratio = capitalized if dominant == "capitalized" else upper
        threshold = flags_config["proper_name_case_ratio"] if dominant == "capitalized" else flags_config["acronym_case_ratio"]
        if ratio is not None and ratio >= threshold:
            preferred = evidence.surfaces[dominant]
    candidate.capitalization = {
        "pattern": dominant,
        "capitalized_vs_lower": None if capitalized is None else ("inf" if math.isinf(capitalized) else round(capitalized, 2)),
        "upper_vs_lower": None if upper is None else ("inf" if math.isinf(upper) else round(upper, 2)),
        "surfaces": dict(sorted(evidence.surfaces.items())),
        "preferred_surface": preferred,
    }
    candidate.surfaces.update(evidence.surfaces.values())


def _lexical_identity(candidate: Candidate, lexicon: Lexicon | None) -> None:
    if lexicon is None:
        return
    form = candidate.normalized
    lemmas = lexicon.lemma_entries(form)
    explicit = lexicon.form_of(form)
    suggestions = lexicon.possible_bases(form)
    analyses: list[dict[str, str]] = []
    # Several lexicon entries can share a spelling and part of speech ("am", "AM", "Am"): one analysis each, no repeats.
    for written, pos in sorted({(entry.written, entry.pos) for entry in lemmas}):
        analyses.append({"relation": "is_lemma", "lemma": form, "pos": pos, "written": written, "evidence": lexicon.source_id})
    for link in explicit:
        analyses.append({"relation": "explicit_form", "lemma": link.lemma, "pos": link.pos, "evidence": f"{lexicon.source_id}:Form"})
    for base, pos, rule in suggestions:
        if not any(item["lemma"] == base and item["pos"] == pos for item in analyses):
            analyses.append({"relation": "possible_regular_inflection", "lemma": base, "pos": pos, "evidence": f"morphy rule {rule}; base is a {lexicon.source_id} {pos}"})
    candidate.analyses = analyses
    candidate.lexicon_lemmas = sorted({entry.written for entry in lemmas})
    candidate.lexfiles = sorted({lexfile for entry in lemmas for lexfile in entry.lexfiles})

    confirmed_targets = {item["lemma"] for item in analyses if item["relation"] == "explicit_form"}
    if lemmas and not confirmed_targets and not suggestions:
        candidate.lemma, candidate.lemma_status = form, "lemma"
    elif not lemmas and len(confirmed_targets) == 1 and not suggestions:
        candidate.lemma, candidate.lemma_status = next(iter(confirmed_targets)), "inflected_form"
        candidate.kind = "inflected_form"
    elif lemmas or confirmed_targets:
        # Several readings ("found": a lemma and a form of "find"; "axes": axe or axis): keep all, decide in review.
        candidate.lemma_status = "ambiguous"
    else:
        candidate.lemma_status = "unresolved"

    if lemmas:
        candidate.parts_of_speech = sorted({entry.pos for entry in lemmas})
        candidate.pos_sources.add(lexicon.source_id)
    elif candidate.lemma_status == "inflected_form":
        candidate.parts_of_speech = sorted({item["pos"] for item in analyses if item["relation"] == "explicit_form"})
        candidate.pos_sources.add(lexicon.source_id)
        candidate.fold_basis = "oewn_explicit_form"
    if explicit:
        candidate.flags.add("irregular_form")
    if suggestions:
        candidate.flags.add("possible_regular_inflection")
    if not lemmas and not explicit:
        candidate.flags.add("not_in_oewn")
    # One entry per other spelling and its variety ("colour" is British, Australian and Canadian against "color").
    grouped: dict[tuple[str, str], dict[str, set[str]]] = {}
    for variant in lexicon.variants.get(form, []):
        slot = grouped.setdefault((variant.form, variant.variety), {"own": set(), "synsets": set()})
        slot["own"].add(variant.own_variety)
        slot["synsets"].update(variant.synsets)
    for (other, variety), slot in sorted(grouped.items()):
        candidate.variants.append(
            {
                "form": other,
                "variety": variety,
                "own_varieties": sorted(slot["own"]),
                "shared_synsets": sorted(slot["synsets"]),
                "evidence": f"{lexicon.source_id}: opposite spelling markers on a shared synset, similar spelling",
            }
        )
    if candidate.variants:
        candidate.flags.add("spelling_variant")
    if not lemmas and not explicit and character_profile(form).has_non_ascii_letter:
        # "café" -> "cafe" is a lexicon lemma: offered as a possible variant only ("rosé" is not "rose").
        plain = strip_accents(form)
        if plain != form and lexicon.has_lemma(plain):
            candidate.analyses.append({"relation": "possible_accent_variant", "lemma": plain, "pos": "", "evidence": f"{lexicon.source_id} has '{plain}'; accents removed"})
            candidate.flags.add("possible_accent_variant")


def _esdb_evidence(candidate: Candidate, lexicon: Lexicon | None, esdb: Esdb) -> None:
    """Adds ESDB morphology to the Open English WordNet analysis (restricted profile only).

    Absence from ESDB proves nothing, so a form ESDB does not know is left as it was.
    Minor readings (archaic, uncommon or "no longer used" entries, e.g. "went" as the past
    of "wend") are recorded but never create ambiguity on their own.
    """
    form = candidate.normalized
    # Spelling variants: lemmas of one ESDB group (one sense) with different spelling codes (colour B / color A).
    known = {(variant["form"], variant["variety"]) for variant in candidate.variants}
    for other, varieties in esdb.variants.get(form, []):
        for variety in varieties:
            if (other, variety) not in known:
                known.add((other, variety))
                candidate.variants.append({"form": other, "variety": variety, "own_varieties": [], "shared_synsets": [], "evidence": f"{esdb.source_id}: same group, different spelling codes"})
                candidate.flags.add("spelling_variant")
    derived = esdb.derived_readings(form)
    selfs = esdb.self_entries(form)
    if not derived and not selfs:
        return
    for reading in derived:
        candidate.analyses.append(
            {
                "relation": "esdb_derived_form",
                "lemma": reading.lemma,
                "pos": "|".join(reading.parts_of_speech) or "unknown",
                "form_type": reading.form_type,
                "sense_note": reading.defn_note,
                "minor": reading.minor,
                "evidence": f"{esdb.source_id}:{reading.form_code}",
            }
        )
    for entry in selfs:
        candidate.analyses.append(
            {"relation": "esdb_lemma", "lemma": form, "pos": "|".join(entry.parts_of_speech) or "unknown", "written": entry.written, "minor": entry.minor, "evidence": esdb.source_id}
        )
    # A reading whose lemma is the word itself ("you" as the objective of "you", "can" as present tense of "can")
    # is the word, not a competing reading.
    self_derived = [reading for reading in derived if not reading.minor and reading.lemma == form]
    major_derived = [reading for reading in derived if not reading.minor and reading.lemma != form]
    major_self = [entry for entry in selfs if not entry.minor]
    derived_lemmas = {reading.lemma for reading in major_derived}
    self_pos = sorted({pos for entry in major_self for pos in entry.parts_of_speech} | {pos for reading in self_derived for pos in reading.parts_of_speech})
    derived_pos = {pos for reading in major_derived for pos in reading.parts_of_speech}
    oewn_forms = {link.lemma for link in lexicon.form_of(form)} if lexicon else set()
    suggestions = {base for base, _pos, _rule in lexicon.possible_bases(form)} if lexicon else set()

    def make_ambiguous() -> None:
        candidate.lemma, candidate.lemma_status, candidate.kind, candidate.fold_basis = None, "ambiguous", "word", None
        candidate.flags.add("inflection_needs_review")
        # Every reading's part of speech is a possible one ("my": a pronoun form, and an interjection).
        new = derived_pos - set(candidate.parts_of_speech)
        if new:
            candidate.parts_of_speech = sorted(set(candidate.parts_of_speech) | new)
            candidate.pos_sources.add(esdb.source_id)

    def contradicted() -> None:
        # The only competing reading was a WordNet-rule suggestion; ESDB lists the word as a lemma with no derived reading.
        if "possible_regular_inflection" in candidate.flags:
            candidate.flags.discard("possible_regular_inflection")
            candidate.flags.add("suggestion_contradicted")

    def add_self_pos() -> None:
        new = set(self_pos) - set(candidate.parts_of_speech)
        if new:
            candidate.parts_of_speech = sorted(set(candidate.parts_of_speech) | new)
            candidate.pos_sources.add(esdb.source_id)

    status = candidate.lemma_status
    if status == "unresolved":
        if len(derived_lemmas) == 1 and not major_self and derived_lemmas <= suggestions:
            # Two independent methods agree on one lemma, and no source lists the form as a word of its own.
            lemma = next(iter(derived_lemmas))
            candidate.lemma, candidate.lemma_status, candidate.kind = lemma, "inflected_form", "inflected_form"
            candidate.fold_basis = "esdb_derived_form+morphy"
            candidate.parts_of_speech = sorted({pos for reading in major_derived for pos in reading.parts_of_speech})
            candidate.pos_sources = {esdb.source_id}
            candidate.flags.discard("possible_regular_inflection")
            candidate.flags.add("esdb_confirmed_inflection")
        elif derived_lemmas:
            make_ambiguous()
            add_self_pos()
        elif self_pos:
            # Function words, contractions and other words Open English WordNet does not cover ("the", "it's").
            candidate.lemma, candidate.lemma_status = form, "lemma"
            add_self_pos()
            contradicted()
    elif status == "lemma":
        if derived_lemmas:
            make_ambiguous()
        add_self_pos()
    elif status == "ambiguous":
        if not derived_lemmas and not oewn_forms and major_self:
            candidate.lemma, candidate.lemma_status = form, "lemma"
            contradicted()
        add_self_pos()
    elif status == "inflected_form":
        # An explicit Open English WordNet form: unfold it if ESDB knows another lemma or lists the form as a word ("media").
        if derived_lemmas - oewn_forms or self_pos:
            make_ambiguous()
            add_self_pos()


def _evidence_level(candidate: Candidate) -> str:
    if candidate.status == "excluded":
        return "excluded"
    if candidate.status == "folded":
        return "automatically_confirmed"
    if candidate.lemma_status in {"lemma", "inflected_form"}:
        return "source_confirmed_needs_review" if candidate.flags & set(ATTENTION_FLAGS) else "automatically_confirmed"
    if candidate.lemma_status == "ambiguous":
        return "ambiguous"
    return "no_evidence"


def _proper_and_acronym_flags(candidate: Candidate, lexicon: Lexicon | None, flags_config: dict[str, Any]) -> None:
    cap = candidate.capitalization
    pattern = cap.get("pattern")
    if pattern not in {"capitalized", "upper"}:
        return
    if candidate.normalized == "i" or candidate.normalized.startswith("i'"):
        # The pronoun "I" (and "I'm", "I've"...) is capitalised by spelling rule, not because it is a name.
        return
    ratio_key = "capitalized_vs_lower" if pattern == "capitalized" else "upper_vs_lower"
    raw = cap.get(ratio_key)
    ratio = math.inf if raw == "inf" else (raw or 0)
    threshold = flags_config["proper_name_case_ratio"] if pattern == "capitalized" else flags_config["acronym_case_ratio"]
    if ratio < threshold:
        return
    entries = lexicon.lemma_entries(candidate.normalized) if lexicon else []
    lowercase_common = [entry for entry in entries if entry.written == entry.written.lower()]
    capitalized_entries = [entry for entry in entries if entry.written != entry.written.lower()]
    if pattern == "upper":
        candidate.flags.add("acronym_likely")
        return
    if lowercase_common:
        # "may", "march", "bill", "turkey": an ordinary word that is also a name or a month.
        candidate.flags.add("capitalization_ambiguous")
        return
    ordinary = set(flags_config.get("proper_lexfiles_ordinary", []))
    lexfiles = {lexfile for entry in capitalized_entries for lexfile in entry.lexfiles}
    if lexfiles & ordinary:
        # Months, days, languages, nationality adjectives: capitalised, but ordinary vocabulary
        # (a sense in one of these lexicographer files wins over person/place senses: "Vietnamese").
        candidate.flags.add("capitalized_ordinary_word")
    else:
        # Only person/place/group senses, or not in the lexicon at all: "London", "Carter", "Rachel".
        candidate.flags.add("proper_name_likely")


def _exclusions(candidate: Candidate, lexicon: Lexicon | None, config: dict[str, Any]) -> None:
    rules = config["exclusions"]
    flags_config = config["flags"]
    form = candidate.normalized
    profile = character_profile(form)
    in_lexicon = bool(lexicon and (lexicon.lemma_entries(form) or lexicon.form_of(form)))
    reasons: list[str] = []
    if rules.get("contains_digit") and profile.has_digit:
        reasons.append("contains_digit")
    if rules.get("non_letter_symbol") and profile.has_other_symbol:
        reasons.append("non_letter_symbol")
    if profile.has_period and not in_lexicon and not profile.has_digit:
        if rules.get("initial") and _INITIAL.match(form):
            # "p.", "j.": initials and page abbreviations, not vocabulary.
            reasons.append("initial")
        else:
            # "e.g", "i.e", "a.m", "etc": some are useful, so they stay for review.
            candidate.flags.add("abbreviation")
    if rules.get("single_letter") and profile.letter_count == 1 and len(form) == 1 and form not in flags_config.get("keep_single_letters", []):
        reasons.append("single_letter")
    if profile.is_roman_numeral and not in_lexicon:
        # Clear numerals ("xiv", "MCC") are excluded; letter strings that may be words ("mmm", "di", "civ") are flagged.
        clearly_numeral = set(form) <= set("ivx") or candidate.capitalization.get("pattern") == "upper"
        if rules.get("roman_numeral") and clearly_numeral:
            reasons.append("roman_numeral")
        else:
            candidate.flags.add("possible_roman_numeral")
    if rules.get("ocr_artefact") and form in set(flags_config.get("ocr_artefacts", [])) and not in_lexicon:
        reasons.append("ocr_artefact")
    if rules.get("clitic_fragment") and (profile.starts_with_apostrophe or form == "n't") and not in_lexicon:
        reasons.append("clitic_fragment")
    if rules.get("possessive_form") and not in_lexicon:
        base = form[:-2] if form.endswith("'s") else form[:-1] if form.endswith("s'") else None
        # "it's", "that's", "let's" are contractions (kept); "john's", "magazine's", "parents'" are possessives.
        if base and base.isalpha() and base not in set(flags_config.get("s_contraction_bases", [])):
            reasons.append("possessive_form")
    if profile.has_apostrophe:
        candidate.flags.add("contains_apostrophe")
    if profile.has_hyphen:
        candidate.flags.add("contains_hyphen")
    if profile.has_non_ascii_letter:
        candidate.flags.add("non_ascii_letters")
    if form in set(flags_config.get("foreign_function_words", [])) or (profile.has_non_ascii_letter and not in_lexicon):
        candidate.flags.add("possible_foreign_token")
    if reasons:
        candidate.status = "excluded"
        candidate.kind = "non_lexical_token"
        candidate.exclusion_reasons = reasons


def _frequency_flags(candidate: Candidate, config: dict[str, Any], enabled: list[str]) -> None:
    observed = [source_id for source_id in enabled if not candidate.ranks[source_id].censored]
    if len(enabled) > 1 and len(observed) == 1:
        candidate.flags.add("single_source")
    wordfreq_rank = candidate.ranks.get(WORDFREQ)
    if wordfreq_rank is not None and (wordfreq_rank.value is None or wordfreq_rank.value < config["flags"]["low_frequency_zipf"]):
        candidate.flags.add("low_frequency")
    if GOOGLE in candidate.ranks and WORDFREQ in candidate.ranks:
        candidate.disagreement = disagreement(candidate.ranks[GOOGLE], candidate.ranks[WORDFREQ], config["ranking"]["disagreement_log10_threshold"])
        if candidate.disagreement:
            candidate.flags.add(f"frequency_disagreement_{candidate.disagreement['direction']}")


def build_candidates(inputs: BuildInputs) -> list[Candidate]:
    config = inputs.config
    enabled = sorted(inputs.frequency_sources)
    pool: list[tuple[str, str]] = []
    seen: set[str] = set()
    for source_id in enabled:
        for form in inputs.frequency_sources[source_id].top(inputs.pool_sizes[source_id]):
            if form not in seen:
                seen.add(form)
                pool.append((form, "frequency_pool"))

    candidates: dict[str, Candidate] = {}

    def make(form: str, origin: str) -> Candidate:
        candidate = Candidate(normalized=form, origin=origin)
        for source_id in enabled:
            source = inputs.frequency_sources[source_id]
            candidate.ranks[source_id] = source_rank(source, form)
            entry = source.entries.get(form)
            if entry:
                candidate.surfaces.update(entry.surfaces)
        if not candidate.surfaces:
            # Added as the lemma of an observed form, without being in any list itself.
            candidate.surfaces.add(form)
        _capitalization(candidate, inputs.case.get(form) if inputs.case is not None else None, config["flags"])
        _lexical_identity(candidate, inputs.lexicon)
        if inputs.esdb is not None:
            _esdb_evidence(candidate, inputs.lexicon, inputs.esdb)
        _exclusions(candidate, inputs.lexicon, config)
        _proper_and_acronym_flags(candidate, inputs.lexicon, config["flags"])
        _frequency_flags(candidate, config, enabled)
        return candidate

    for form, origin in pool:
        candidates[form] = make(form, origin)

    # Fold confirmed forms into their lemma (added if it was not in the pool), keeping both records:
    # explicit Open English WordNet forms, and (restricted profile) ESDB-confirmed regular forms.
    for form in sorted(candidates):
        candidate = candidates[form]
        if candidate.status != "retained" or candidate.lemma_status != "inflected_form" or candidate.lemma is None:
            continue
        lemma = candidates.get(candidate.lemma)
        if lemma is None:
            lemma = make(candidate.lemma, "lemma_of_observed_form")
            candidates[candidate.lemma] = lemma
        if lemma.status != "retained":
            continue
        candidate.status = "folded"
        candidate.folded_into = lemma.candidate_id
        lemma.folded_forms.append(form)

    # A lemma's frequency includes its folded (explicit irregular) forms: "be" with is/was/were,
    # "datum" with "data". Within one source only: wordfreq proportions are summed; the Google
    # lists only have ranks, so the best rank of the group is used (stated in the output).
    for lemma in candidates.values():
        if not lemma.folded_forms:
            continue
        group = [lemma.normalized, *lemma.folded_forms]
        for source_id in enabled:
            source = inputs.frequency_sources[source_id]
            present = [source.entries[form] for form in group if form in source.entries]
            if not present:
                continue
            if source.has_frequencies:
                total = sum(entry.frequency or 0.0 for entry in present)
                lemma.aggregated[source_id] = SourceRank(rank=source.rank_for_frequency(total), censored=False, value=zipf(total))
                if source_id == WORDFREQ and zipf(total) >= config["flags"]["low_frequency_zipf"]:
                    lemma.flags.discard("low_frequency")
            else:
                lemma.aggregated[source_id] = SourceRank(rank=min(entry.rank for entry in present), censored=False, value=None)

    method = config["ranking"]["method"]
    primary = config["ranking"].get("primary_source")
    secondary = config["ranking"].get("secondary_source")
    ordered = sorted(candidates.values(), key=lambda item: ordering_key({**item.ranks, **item.aggregated}, item.normalized, method, primary, secondary))
    retained_position = 0
    for position, candidate in enumerate(ordered, start=1):
        candidate.combined_rank = position
        candidate.folded_forms.sort()
        candidate.evidence_level = _evidence_level(candidate)
        if candidate.status == "retained":
            retained_position += 1
            candidate.retained_rank = retained_position
    return ordered


def candidate_record(candidate: Candidate, enabled_sources: list[str]) -> dict[str, Any]:
    """The JSON shape of one candidate (field order is part of the output contract)."""
    frequency = {}
    for source_id in enabled_sources:
        rank = candidate.ranks[source_id]
        frequency[source_id] = {"rank": rank.rank, "rank_censored": rank.censored, "value": rank.value, "with_folded_forms": None}
        aggregated = candidate.aggregated.get(source_id)
        if aggregated is not None:
            method = "summed frequency" if aggregated.value is not None else "best rank of the group (ranks only)"
            frequency[source_id]["with_folded_forms"] = {"rank": aggregated.rank, "value": aggregated.value, "method": method}
    return {
        "candidate_id": candidate.candidate_id,
        "language": "en",
        "surface_form": candidate.surface_form,
        "normalized_form": candidate.normalized,
        "surface_forms": sorted(candidate.surfaces),
        "candidate_kind": candidate.kind,
        "candidate_status": candidate.status,
        "exclusion_reasons": candidate.exclusion_reasons,
        "folded_into": candidate.folded_into,
        "folded_forms": candidate.folded_forms,
        "fold_basis": candidate.fold_basis,
        "lemma": candidate.lemma,
        "lemma_status": candidate.lemma_status,
        "evidence_level": candidate.evidence_level,
        "lemma_analyses": candidate.analyses,
        "part_of_speech": candidate.parts_of_speech,
        # Which sources the parts of speech come from ("unknown" when none establishes one).
        "part_of_speech_status": "+".join(sorted(candidate.pos_sources)) if candidate.parts_of_speech else "unknown",
        "lexicon_lemmas": candidate.lexicon_lemmas,
        "lexfiles": candidate.lexfiles,
        "spelling_variants": candidate.variants,
        "source_ids": [source_id for source_id in enabled_sources if not candidate.ranks[source_id].censored],
        "source_coverage": sum(1 for source_id in enabled_sources if not candidate.ranks[source_id].censored),
        "frequency": frequency,
        "combined_rank": candidate.combined_rank,
        "retained_rank": candidate.retained_rank,
        "frequency_disagreement": candidate.disagreement,
        "capitalization": candidate.capitalization,
        "flags": sorted(candidate.flags),
        "origin": candidate.origin,
        "review_status": "unreviewed",
        "enrichment": dict(EMPTY_ENRICHMENT),
    }
