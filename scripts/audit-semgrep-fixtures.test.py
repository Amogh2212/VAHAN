#!/usr/bin/env python3
"""Run repository Semgrep rules against positive and negative fixtures."""

from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "audit" / "semgrep-fixtures"
EXPECTATION = re.compile(r"(?:#|//)\s*audit-expect:\s*([a-z0-9-]+)\s*$")


def expected_findings(path: pathlib.Path, target_name: str) -> set[tuple[str, int, str]]:
    expected: set[tuple[str, int, str]] = set()
    lines = path.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines, start=1):
        marker = EXPECTATION.search(line)
        if marker:
            expected.add((target_name, index + 1, marker.group(1)))
    return expected


def run_semgrep(workspace: pathlib.Path, targets: list[str]) -> list[dict]:
    command = [
        "semgrep",
        "scan",
        "--config",
        "audit/semgrep.yml",
        "--strict",
        "--json",
        "--metrics",
        "off",
        "--oss-only",
        "--no-git-ignore",
        *targets,
    ]
    completed = subprocess.run(
        command,
        cwd=workspace,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "Semgrep fixture scan failed.\n"
            f"command: {' '.join(command)}\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Semgrep did not emit valid JSON: {error}\n{completed.stdout}") from error
    errors = payload.get("errors", [])
    if errors:
        raise RuntimeError(f"Semgrep fixture scan reported errors: {json.dumps(errors, indent=2)}")
    return payload.get("results", [])


def finding_key(result: dict) -> tuple[str, int, str]:
    rule_id = str(result.get("check_id", ""))
    return (
        str(result.get("path", "")).replace("\\", "/"),
        int((result.get("start") or {}).get("line", 0)),
        rule_id.removeprefix("audit."),
    )


def main() -> int:
    if shutil.which("semgrep") is None:
        print("semgrep executable is required for fixture tests", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="vahan-semgrep-fixtures-") as temporary_directory:
        workspace = pathlib.Path(temporary_directory)
        (workspace / "audit").mkdir(parents=True)
        (workspace / ".github" / "workflows").mkdir(parents=True)
        shutil.copy2(ROOT / "audit" / "semgrep.yml", workspace / "audit" / "semgrep.yml")

        fixture_targets = {
            "javascript-positive.mjs": "javascript-positive.mjs",
            "javascript-negative.mjs": "javascript-negative.mjs",
            "workflow-positive.yml": ".github/workflows/workflow-positive.yml",
            "workflow-negative.yml": ".github/workflows/workflow-negative.yml",
        }
        for source_name, target_name in fixture_targets.items():
            target = workspace / target_name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(FIXTURES / source_name, target)

        positive_targets = ["javascript-positive.mjs", ".github/workflows/workflow-positive.yml"]
        positive_results = run_semgrep(workspace, positive_targets)
        actual = {finding_key(result) for result in positive_results}
        expected = set()
        for source_name, target_name in (
            ("javascript-positive.mjs", "javascript-positive.mjs"),
            ("workflow-positive.yml", ".github/workflows/workflow-positive.yml"),
        ):
            expected.update(expected_findings(FIXTURES / source_name, target_name))

        missing = expected - actual
        unexpected = actual - expected
        if missing or unexpected:
            print("Semgrep fixture findings did not match expectations.", file=sys.stderr)
            if missing:
                print(f"Missing: {sorted(missing)}", file=sys.stderr)
            if unexpected:
                print(f"Unexpected: {sorted(unexpected)}", file=sys.stderr)
            return 1

        negative_targets = ["javascript-negative.mjs", ".github/workflows/workflow-negative.yml"]
        negative_results = run_semgrep(workspace, negative_targets)
        if negative_results:
            print(
                "Negative Semgrep fixtures unexpectedly produced findings:\n"
                + json.dumps([finding_key(result) for result in negative_results], indent=2),
                file=sys.stderr,
            )
            return 1

    print(f"Semgrep fixtures passed: {len(expected)} expected findings; negative fixtures clean.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
