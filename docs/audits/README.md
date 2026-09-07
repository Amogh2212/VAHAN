# Codebase audit reports

Sanitized, intentionally published Vahan EY audit reports live here. Machine artifacts and command logs stay under ignored `audit-output/`.

Create a report from a completed run without overwriting an existing report:

```powershell
npm.cmd run audit:report -- --input audit-output/<run-id> --publish
```

Published reports must preserve pass/fail/skip distinctions, identify the audited HEAD and baseline, state whether the worktree changed during execution, and contain no raw environment values, credentials, cookies, tokens, URL query strings, database URLs, or unsanitized scanner snippets.
