#!/usr/bin/env python3
"""Reduce Semgrep JSON to sanitized metadata before artifact upload."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
from collections import Counter
from collections.abc import Mapping
from urllib.parse import urlsplit, urlunsplit


SECRET_PATTERNS = [
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bgsk_[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
]
CREDENTIAL_URL = re.compile(r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s\"'<>]+", re.I)
HTTP_URL = re.compile(r"https?://[^\s\"'<>]+", re.I)
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
SAFE_FINDING_MESSAGE = "Semgrep reported a match; inspect the rule and source location locally."
SAFE_ERROR_MESSAGE = "Semgrep reported an error; inspect the GitHub Actions log."


def sanitize_text(value: object) -> str:
    text = CONTROL.sub("", str(value or ""))
    text = CREDENTIAL_URL.sub("[REDACTED_CONNECTION_URL]", text)
    for pattern in SECRET_PATTERNS:
        text = pattern.sub("[REDACTED_KEY]", text)
    return HTTP_URL.sub(redact_query, text)


def redact_query(match: re.Match[str]) -> str:
    try:
        split = urlsplit(match.group(0))
        hostname = split.hostname
        if not hostname:
            return "[REDACTED_URL]"
        if ":" in hostname and not hostname.startswith("["):
            hostname = f"[{hostname}]"
        port = split.port
        netloc = f"{hostname}:{port}" if port is not None else hostname
        return urlunsplit(
            (
                split.scheme,
                netloc,
                split.path,
                "REDACTED_QUERY" if split.query else "",
                "REDACTED_FRAGMENT" if split.fragment else "",
            )
        )
    except (TypeError, ValueError):
        return "[REDACTED_URL]"


def sanitize_position(position: object) -> dict[str, int | None]:
    if not isinstance(position, Mapping):
        return {"line": None, "col": None}
    return {
        "line": position.get("line") if isinstance(position.get("line"), int) else None,
        "col": position.get("col") if isinstance(position.get("col"), int) else None,
    }


def sanitize_result(result: Mapping) -> dict:
    extra = result.get("extra")
    if not isinstance(extra, Mapping):
        extra = {}
    metadata = extra.get("metadata")
    if not isinstance(metadata, Mapping):
        metadata = {}
    allowed_metadata = {
        key: sanitize_text(metadata[key])
        for key in ("category", "confidence", "technology", "cwe", "owasp")
        if key in metadata
    }
    return {
        "check_id": sanitize_text(result.get("check_id")),
        "path": sanitize_text(result.get("path")).replace("\\", "/"),
        "start": sanitize_position(result.get("start")),
        "end": sanitize_position(result.get("end")),
        # Registry rules may interpolate matched metavariables into extra.message.
        # Keep the artifact useful without copying any matched source text.
        "message": SAFE_FINDING_MESSAGE,
        "severity": sanitize_text(extra.get("severity")),
        "metadata": allowed_metadata,
    }


def sanitize_error(error: object) -> dict[str, str]:
    return {
        "type": "scanner_error",
        "message": SAFE_ERROR_MESSAGE,
    }


def load_payload(source: pathlib.Path) -> tuple[list[dict], list[dict[str, str]], bool]:
    """Return sanitized results, safe errors, and whether raw output was malformed."""
    if not source.exists():
        return [], [{"type": "missing_raw_output", "message": "Semgrep did not create JSON output."}], True

    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return [], [{"type": "invalid_raw_output", "message": "Semgrep JSON output was unavailable or invalid."}], True

    if not isinstance(payload, Mapping):
        return [], [{"type": "invalid_raw_output", "message": "Semgrep JSON output was unavailable or invalid."}], True

    raw_results = payload.get("results", [])
    raw_errors = payload.get("errors", [])
    if not isinstance(raw_results, list) or not isinstance(raw_errors, list):
        return [], [{"type": "invalid_raw_output", "message": "Semgrep JSON output was unavailable or invalid."}], True

    results = [sanitize_result(item) for item in raw_results if isinstance(item, Mapping)]
    errors = [sanitize_error(item) for item in raw_errors]
    malformed_results = len(results) != len(raw_results)
    malformed_errors = any(not isinstance(item, Mapping) for item in raw_errors)
    malformed = malformed_results or malformed_errors
    if malformed_results:
        errors.append({"type": "invalid_result_entry", "message": "A malformed Semgrep result was omitted."})
    if malformed_errors:
        errors.append({"type": "invalid_error_entry", "message": "A malformed Semgrep error was replaced."})
    return results, errors, malformed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--summary", required=True)
    args = parser.parse_args()
    source = pathlib.Path(args.input)
    destination = pathlib.Path(args.output)
    summary = pathlib.Path(args.summary)
    destination.parent.mkdir(parents=True, exist_ok=True)
    summary.parent.mkdir(parents=True, exist_ok=True)

    try:
        results, errors, malformed = load_payload(source)
        sanitized = {"schemaVersion": "1.0.0", "results": results, "errors": errors}
        destination.write_text(json.dumps(sanitized, indent=2) + "\n", encoding="utf-8")
        counts = Counter(item["severity"] or "UNKNOWN" for item in results)
        summary.write_text(
            "# Semgrep CE summary\n\n"
            f"Findings: {len(results)}\n\n"
            + "\n".join(f"- {severity}: {count}" for severity, count in sorted(counts.items()))
            + f"\n\nScanner errors: {len(errors)}\n",
            encoding="utf-8",
        )
    finally:
        # Raw Semgrep JSON can contain matched source and metavariables. Never
        # leave it behind for the artifact upload step, including on failures.
        source.unlink(missing_ok=True)
    return 1 if malformed else 0


if __name__ == "__main__":
    raise SystemExit(main())
