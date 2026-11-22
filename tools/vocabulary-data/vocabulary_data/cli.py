"""Command line.

Run from tools/vocabulary-data with the pipeline's Python environment. The
configuration decides the profile; outputs always land under output/<profile>/.

    python -m vocabulary_data check-sources                       # Profile A (config/pipeline.json)
    python -m vocabulary_data run --out run-1                     # -> output/restricted/run-1
    python -m vocabulary_data --config config/redistributable.json run --out run-1
                                                                  # -> output/redistributable/run-1
    python -m vocabulary_data --config config/redistributable.json propose-pilot --run run-1 --out pilot-1
    python -m vocabulary_data crosscheck-pilot --pilot pilot-1 --run run-1 --out crosscheck-1
    python -m vocabulary_data validate output/restricted/run-1
    python -m vocabulary_data compare output/restricted/run-1 output/restricted/run-2
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import PIPELINE_VERSION
from .crosscheck import write_crosscheck
from .fetch import SourceError, fetch_source, verify_source
from .manifest import TOOL_ROOT, ManifestError, enabled_sources, load_config, load_register
from .outputs import OutputError, compare_runs, portable_path, profile_root, validate_run, write_run
from .pilot import write_pilot
from .review import validate_review, write_review
from .pipeline import run_pipeline

DEFAULT_REGISTER = TOOL_ROOT / "sources" / "manifest.json"
DEFAULT_CONFIG = TOOL_ROOT / "config" / "pipeline.json"


def _setup(args: argparse.Namespace):
    register = load_register(Path(args.sources))
    config, config_sha = load_config(Path(args.config), register)
    raw_dir = (TOOL_ROOT / config["raw_dir"]).resolve()
    return register, config, config_sha, raw_dir


def _folder(name: str, profile: str) -> Path:
    """A bare name is a folder under output/<profile>/; a path is taken as given (and must still be inside it)."""
    path = Path(name)
    if len(path.parts) == 1 and not path.is_absolute():
        return profile_root(profile) / name
    return path if path.is_absolute() else (Path.cwd() / path).resolve()


def cmd_check_sources(args: argparse.Namespace) -> int:
    register, config, config_sha, raw_dir = _setup(args)
    print(f"Source register OK ({len(register.sources)} sources). Configuration OK: profile {config['profile']} (sha256 {config_sha[:12]}…).")
    for source_id, source in sorted(register.sources.items()):
        print(f"- {source_id}: {source['status']}, distribution {source['distribution']}, profiles {', '.join(source.get('profiles', [])) or 'none'}, licence {source['licence']['id']}")
    failures = 0
    for source_id in enabled_sources(config):
        try:
            for item in verify_source(register, source_id, raw_dir):
                checksum = item.get("sha256") or item.get("content_sha256")
                print(f"  verified {item['file']} sha256 {checksum[:12]}…")
        except SourceError as error:
            failures += 1
            print(f"  NOT READY: {error}")
    return 1 if failures else 0


def cmd_fetch(args: argparse.Namespace) -> int:
    register, config, _, raw_dir = _setup(args)
    targets = enabled_sources(config) if args.all else [args.source]
    for source_id in targets:
        for line in fetch_source(register, source_id, raw_dir):
            print(line)
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    register, config, config_sha, raw_dir = _setup(args)
    out_dir = _folder(args.out, config["profile"])
    result = run_pipeline(config, register, raw_dir)
    manifest = write_run(out_dir, result, config, Path(args.config), config_sha, Path(args.sources), PIPELINE_VERSION)
    retained = sum(1 for candidate in result.candidates if candidate.status == "retained")
    print(f"Wrote {portable_path(out_dir)}: profile {result.profile}, {len(result.candidates)} candidates, {retained} retained. Distribution: {manifest['distribution']}.")
    problems = validate_run(out_dir)
    for problem in problems:
        print(f"  VALIDATION: {problem}")
    return 1 if problems else 0


def cmd_propose_pilot(args: argparse.Namespace) -> int:
    _register, config, _sha, _raw = _setup(args)
    if config["profile"] != "redistributable" or "pilot" not in config:
        raise ManifestError("propose-pilot needs the redistributable configuration (--config config/redistributable.json) with a 'pilot' section.")
    run_dir = _folder(args.run, "redistributable")
    out_dir = _folder(args.out, "redistributable")
    write_pilot(run_dir, out_dir, config["pilot"])
    report = (out_dir / "pilot-report.md").read_text(encoding="utf-8").splitlines()[2]
    print(f"Wrote {portable_path(out_dir)}. {report}")
    return 0


def cmd_crosscheck_pilot(args: argparse.Namespace) -> int:
    pilot_dir = _folder(args.pilot, "redistributable")
    run_dir = _folder(args.run, "restricted")
    out_dir = _folder(args.out, "restricted")
    write_crosscheck(pilot_dir, run_dir, out_dir)
    print(f"Wrote {portable_path(out_dir)} (restricted, local only).")
    return 0


def cmd_review_package(args: argparse.Namespace) -> int:
    pilot_dir = _folder(args.pilot, "redistributable")
    run_dir = _folder(args.run, "redistributable")
    out_dir = _folder(args.out, "redistributable")
    write_review(pilot_dir, run_dir, out_dir, Path(args.checklist), args.batches, replace=args.replace)
    problems = validate_review(out_dir, pilot_dir)
    print(f"Wrote {portable_path(out_dir)} (redistributable review package).")
    for problem in problems:
        print(f"  VALIDATION: {problem}")
    return 1 if problems else 0


def cmd_validate_review(args: argparse.Namespace) -> int:
    problems = validate_review(_folder(args.package, "redistributable"), _folder(args.pilot, "redistributable"))
    for problem in problems:
        print(f"- {problem}")
    if not problems:
        print("Review package is complete: every pilot candidate exactly once (all and batches), traceable, review columns empty, no restricted traces.")
    return 1 if problems else 0


def cmd_validate(args: argparse.Namespace) -> int:
    problems = validate_run(Path(args.run))
    if problems:
        for problem in problems:
            print(f"- {problem}")
        return 1
    print("Run outputs are consistent: checksums, JSON/CSV agreement, statuses, ranks, evidence levels, attribution, profile isolation, no machine paths, no invented enrichment.")
    return 0


def cmd_compare(args: argparse.Namespace) -> int:
    differences = compare_runs(Path(args.first), Path(args.second))
    if differences:
        for difference in differences:
            print(f"- {difference}")
        return 1
    print("Identical deterministic outputs.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vocabulary_data", description="Vocabulary candidate pipeline (offline tooling).")
    parser.add_argument("--sources", default=str(DEFAULT_REGISTER), help="Source register (default: sources/manifest.json).")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="Configuration; its 'profile' decides restricted or redistributable (default: config/pipeline.json, restricted).")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check-sources", help="Validate the register and configuration, and verify local inputs.").set_defaults(handler=cmd_check_sources)
    fetch = commands.add_parser("fetch", help="Download pinned source files into raw/ (explicit network step).")
    group = fetch.add_mutually_exclusive_group(required=True)
    group.add_argument("--source", help="One source id.")
    group.add_argument("--all", action="store_true", help="Every source enabled in the configuration.")
    fetch.set_defaults(handler=cmd_fetch)
    run = commands.add_parser("run", help="Generate candidates into a new folder under output/<profile>/.")
    run.add_argument("--out", required=True, help="Run name (or a path inside output/<profile>/); must not already contain files.")
    run.set_defaults(handler=cmd_run)
    pilot = commands.add_parser("propose-pilot", help="Build the enrichment-pilot proposal from a redistributable run.")
    pilot.add_argument("--run", required=True, help="Redistributable run name or path.")
    pilot.add_argument("--out", required=True, help="New folder name under output/redistributable/.")
    pilot.set_defaults(handler=cmd_propose_pilot)
    cross = commands.add_parser("crosscheck-pilot", help="Restricted local cross-check of a pilot proposal.")
    cross.add_argument("--pilot", required=True, help="Pilot folder name or path (redistributable).")
    cross.add_argument("--run", required=True, help="Restricted run name or path.")
    cross.add_argument("--out", required=True, help="New folder name under output/restricted/.")
    cross.set_defaults(handler=cmd_crosscheck_pilot)
    review = commands.add_parser("review-package", help="Build the human-review package for a redistributable pilot.")
    review.add_argument("--pilot", required=True, help="Redistributable pilot folder name or path.")
    review.add_argument("--run", required=True, help="The redistributable run the pilot was built from.")
    review.add_argument("--out", required=True, help="New folder name under output/redistributable/.")
    review.add_argument("--batches", type=int, default=8, help="Number of review batches (default 8).")
    review.add_argument("--replace", action="store_true", help="Regenerate in place, only if the folder holds a review package of the same pilot and run.")
    review.add_argument("--checklist", default=str(TOOL_ROOT / "config" / "function-word-checklist.json"), help="Function-word checklist for the coverage report.")
    review.set_defaults(handler=cmd_review_package)
    check_review = commands.add_parser("validate-review", help="Check a review package against its pilot.")
    check_review.add_argument("package")
    check_review.add_argument("--pilot", required=True)
    check_review.set_defaults(handler=cmd_validate_review)
    validate = commands.add_parser("validate", help="Check a run folder for consistency and profile isolation.")
    validate.add_argument("run")
    validate.set_defaults(handler=cmd_validate)
    compare = commands.add_parser("compare", help="Compare the deterministic outputs of two runs.")
    compare.add_argument("first")
    compare.add_argument("second")
    compare.set_defaults(handler=cmd_compare)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.handler(args)
    except (ManifestError, SourceError, OutputError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
