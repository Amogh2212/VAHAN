# Oracle scraper worker handoff

The Oracle VM is a scraper worker only. Render serves the dashboard/API and
Neon remains the shared database, queue, and retry state. Do not create a
second database or deploy a scraper service on Render.

## Prepare the VM

1. Create an Ubuntu VM, install Node.js 22, Git, and the Chromium dependencies
   required by Playwright.
2. Clone the same `main` revision to `/opt/vahan-ey`, run `npm ci`, and install
   Chromium with `npx playwright install --with-deps chromium`.
3. Create the unprivileged `vahan-ey` user and make it the owner of
   `/opt/vahan-ey`.
4. Create `/etc/vahan-ey/rto-worker.env` from `rto-worker.env.example`, replace
   `DATABASE_URL` with the Neon pooled connection string, then set owner to
   `root:vahan-ey` and permissions to `0640`.
5. Copy the service and timer files to `/etc/systemd/system/`, then run
   `systemctl daemon-reload`.

## Safe cutover

1. Confirm Neon has no actively running laptop lease and that the laptop task
   is not currently executing.
2. Disable `VahanEY-RtoDaily-Neon` on Windows. Do not delete queue rows or
   start a fresh daily cycle.
3. On Oracle, run one targeted pilot manually with the same environment. Check
   that it reaches VAHAN and records its result in Neon.
4. Enable and start `vahan-ey-rto-worker.timer`. Inspect logs with
   `journalctl -u vahan-ey-rto-worker.service` and verify the Neon queue after
   the first timer run.

The database advisory lock is an additional protection, but the laptop task
and Oracle timer must not be intentionally enabled together.

## Rollback

Stop and disable the Oracle timer. After the active Oracle worker exits, enable
the Windows task again; it will continue from the same Neon queue.
