#!/usr/bin/env python3
"""Regression tests for the Semgrep artifact sanitizer."""

from __future__ import annotations

import json
import pathlib
import runpy
import subprocess
import sys
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).with_name("audit-sanitize-semgrep.py")
SANITIZER = runpy.run_path(str(SCRIPT))


class SemgrepSanitizerTests(unittest.TestCase):
    def test_http_url_removes_userinfo_query_and_fragment(self) -> None:
        raw = "https://alice:hunter2@example.invalid/report?token=top-secret#private-fragment"
        sanitized = SANITIZER["sanitize_text"](raw)

        self.assertEqual(
            sanitized,
            "https://example.invalid/report?REDACTED_QUERY#REDACTED_FRAGMENT",
        )
        for secret in ("alice", "hunter2", "top-secret", "private-fragment"):
            self.assertNotIn(secret, sanitized)

    def test_finding_message_and_metavariables_are_not_copied(self) -> None:
        result = {
            "check_id": "registry.example-rule",
            "path": "src/example.mjs",
            "start": {"line": 7, "col": 3},
            "end": {"line": 7, "col": 30},
            "extra": {
                "message": "Matched hunter2-company-password in $SECRET",
                "severity": "ERROR",
                "metavars": {
                    "$SECRET": {"abstract_content": "hunter2-company-password"},
                },
                "metadata": {"category": "security", "confidence": "HIGH"},
            },
        }

        sanitized = SANITIZER["sanitize_result"](result)
        encoded = json.dumps(sanitized)
        self.assertEqual(sanitized["message"], SANITIZER["SAFE_FINDING_MESSAGE"])
        self.assertNotIn("hunter2-company-password", encoded)
        self.assertNotIn("metavars", encoded)
        self.assertNotIn("$SECRET", encoded)

    def test_malformed_error_entries_are_safe_and_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_directory:
            temp = pathlib.Path(temp_directory)
            source = temp / "raw.json"
            destination = temp / "sanitized.json"
            summary = temp / "summary.md"
            source.write_text(
                json.dumps(
                    {
                        "results": [],
                        "errors": [
                            {"type": "ParseError", "message": "hunter2-error-detail"},
                            "hunter2-malformed-error",
                        ],
                    }
                ),
                encoding="utf-8",
            )

            completed = self.run_sanitizer(source, destination, summary)

            self.assertNotEqual(completed.returncode, 0)
            self.assertFalse(source.exists())
            sanitized = json.loads(destination.read_text(encoding="utf-8"))
            encoded = json.dumps(sanitized)
            self.assertNotIn("hunter2-error-detail", encoded)
            self.assertNotIn("hunter2-malformed-error", encoded)
            self.assertTrue(all(error["type"] != "ParseError" for error in sanitized["errors"]))
            self.assertIn("invalid_error_entry", {error["type"] for error in sanitized["errors"]})

    def test_invalid_json_still_writes_safe_evidence_and_removes_raw_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_directory:
            temp = pathlib.Path(temp_directory)
            source = temp / "raw.json"
            destination = temp / "sanitized.json"
            summary = temp / "summary.md"
            source.write_text('{"results": [', encoding="utf-8")

            completed = self.run_sanitizer(source, destination, summary)

            self.assertNotEqual(completed.returncode, 0)
            self.assertFalse(source.exists())
            sanitized = json.loads(destination.read_text(encoding="utf-8"))
            self.assertEqual(sanitized["results"], [])
            self.assertEqual(sanitized["errors"][0]["type"], "invalid_raw_output")
            self.assertIn("Scanner errors: 1", summary.read_text(encoding="utf-8"))

    @staticmethod
    def run_sanitizer(
        source: pathlib.Path,
        destination: pathlib.Path,
        summary: pathlib.Path,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--input",
                str(source),
                "--output",
                str(destination),
                "--summary",
                str(summary),
            ],
            check=False,
            capture_output=True,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
