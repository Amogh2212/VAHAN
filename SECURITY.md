# Security

## Supported release

Only the current default branch is eligible for security fixes. Do not deploy a
revision unless `npm test` and `npm run check:audit` both pass.

## Reporting a vulnerability

Report suspected vulnerabilities privately to the repository owner. Do not open
a public issue containing credentials, session cookies, personal data, or a
working exploit. Include the affected route, impact, reproduction steps, and any
logs with secrets removed.

## User data

The application stores the Google account subject, email, display name, profile
picture URL, session identifiers, optional Telegram chat ID, tracked queries,
query observations, and pinned RTOs. It does not need Google access or refresh
tokens after sign-in.

- Session cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax`.
- State-changing account requests require a same-origin CSRF token.
- Users can export their stored data through `GET /api/account/export`.
- Users can delete their account and cascading personal records through
  `DELETE /api/account` with the JSON confirmation `{"confirm":"DELETE"}`.
- Expired sessions and Telegram link codes are pruned automatically.

## Production prerequisites

- Keep `VAHAN_DISABLE_LIVE_REFRESH=1`; production HTTP requests cannot launch a
  live browser scraper.
- Use an HTTPS `APP_BASE_URL`, a secret-manager `CSRF_SECRET` of at least 32
  random characters, and verified `ADMIN_EMAILS`.
- Use `RATE_LIMIT_STORE=database`; in-memory limiting is intended only for
  development and isolated smoke tests.
- Apply `db/schema.sql` before starting a new application revision.
- Give the application database role only the permissions required by this
  schema. Encrypt the database and backups, test restore into a disposable
  database, and rotate database/OAuth/AI/Telegram secrets after any exposure.
- Set `TRUST_PROXY_HOPS` only to the exact number of reverse proxies that
  overwrite or append `X-Forwarded-For`.

## Retention and logs

Keep personal data only while the account is active or while required for the
user-facing feature. Production logs must not contain cookies, OAuth codes,
authorization headers, API keys, database passwords, or full query strings.
Restrict log and backup access to operators who need it, and document deletion
and restore procedures before accepting users.
