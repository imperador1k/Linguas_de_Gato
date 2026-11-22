"""Turning per-source ranks into one ordering, without pretending they are the same measure.

Raw numbers from different sources are never added: the Google lists only
give ranks, wordfreq gives proportions on a Zipf scale. Each source is reduced
to a rank (1 = most frequent). A word missing from a ranked list is "rarer than
that list's cut-off", so it gets the rank just past the end, marked censored.

Methods (config `ranking.method`):
- primary (default): order by the primary source's rank, then the secondary
  source's rank, then the word. wordfreq is the default primary because it
  already blends subtitles, web, news, Wikipedia and books; adding the Google
  books ranks again with a weight would count books twice.
- mean_log_rank: geometric mean of the (censored) ranks of every enabled
  frequency source, i.e. equal weight per source on a logarithmic scale. Offered
  for comparison; it has no empirical calibration behind the equal weights.

The original per-source ranks and values always stay in the output.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .adapters import FrequencySource


@dataclass(frozen=True)
class SourceRank:
    rank: int
    censored: bool
    value: float | None


def source_rank(source: FrequencySource, normalized: str) -> SourceRank:
    entry = source.entries.get(normalized)
    if entry is None:
        return SourceRank(rank=source.list_length + 1, censored=True, value=None)
    return SourceRank(rank=entry.rank, censored=False, value=entry.value)


def ordering_key(ranks: dict[str, SourceRank], normalized: str, method: str, primary: str | None, secondary: str | None) -> tuple:
    if method == "primary":
        first = ranks[primary].rank if primary in ranks else math.inf
        second = ranks[secondary].rank if secondary in ranks else math.inf
        return (first, second, normalized)
    if method == "mean_log_rank":
        logs = [math.log(rank.rank) for rank in ranks.values()]
        return (math.exp(sum(logs) / len(logs)) if logs else math.inf, normalized)
    raise ValueError(f"Unknown ranking method {method!r}")


def disagreement(books: SourceRank | None, everyday: SourceRank | None, threshold: float) -> dict | None:
    """log10(books rank / everyday rank): negative = more frequent in books than in everyday sources.

    Only reported when at least one rank is real; a censored rank gives a bound, marked as such.
    """
    if books is None or everyday is None or (books.censored and everyday.censored):
        return None
    value = math.log10(books.rank / everyday.rank)
    if abs(value) < threshold:
        return None
    direction = "books_higher" if value < 0 else "everyday_higher"
    return {"log10_rank_ratio": round(value, 2), "direction": direction, "bound": books.censored or everyday.censored}
