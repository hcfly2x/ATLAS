---
name: atlas-frontend-qa
description: Validate ATLAS Dashboard frontend changes before delivery. Use after changing apps/dashboard, shared UI contracts, styling, routing, accessibility, or browser-visible behavior.
---

# ATLAS Frontend QA

Run this workflow before delivering a Dashboard change.

## Required checks

1. Review the diff against the authorized scope and run a dependency allowlist
   probe.
2. Install from the committed lockfile and run format, lint, typecheck, unit
   tests, and production build.
3. Run React Doctor with telemetry disabled; warnings fail the phase unless
   explicitly reviewed.
4. Run Playwright against the built application and assert user-visible
   behavior, not implementation details.
5. Run axe-core on the rendered surface and fail on accessibility violations.
6. Validate shared contracts against a serialized real service response.
7. Inspect emitted evidence for prompts, raw payloads, destinations, tokens,
   credentials, command arguments, and other sensitive content.

## Failure policy

- A missing browser, denied command, timeout, invalid contract, accessibility
  violation, scope drift, or unavailable required tool is not a pass.
- Do not weaken application governance or tests to make the QA green.
- Do not perform deploy, merge, backend writes, or state transitions as part of
  frontend QA.

## Handoff

Report commands, outcomes, environment limitations, remaining risks, and the
browser behavior that was actually observed.
