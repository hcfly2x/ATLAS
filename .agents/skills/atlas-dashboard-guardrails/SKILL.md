---
name: atlas-dashboard-guardrails
description: Preserve ATLAS Dashboard product, security, and governance boundaries. Use before scoping or implementing any Dashboard frontend, route, interaction, visualization, or workflow.
---

# ATLAS Dashboard Guardrails

Use this skill before changing the Dashboard.

## Workflow

1. Read `AGENTS.md`, `specifications/project-manifest.yaml`,
   `docs/dashboard-operational-plan.md`, `docs/product-philosophy.md`,
   `docs/security.md`, and the applicable ADR.
2. Identify the authorized track and compare the requested diff with it.
3. Keep the interface workflow-first: task lifecycle and decisions precede
   screens, components, or decoration.
4. Reuse coordinator read models. Do not create a second backend, datastore,
   state machine, approval model, or business rule in the frontend.
5. Treat missing or unverifiable signals as `indeterminado`; never invent
   progress, ETA, cost, priority, or successful delivery.
6. Stop and request explicit authorization if the work adds writing, real-time
   transport, persistence, LLM narration, authentication changes, or a new
   dependency outside the approved manifest.

## Permanent boundaries

- The frontend remains read-only until Track C is separately authorized.
- Preserve `Approval`, `always_human`, deterministic enforcement, TaskState,
  fencing, leases, and audit behavior.
- Never expose prompts, raw responses, payloads, `messageText`, destinations,
  credentials, chain-of-thought, or other raw content.
- Do not center the product on chat, infrastructure metrics, an organization
  chart, decorative avatars, or pages without a workflow decision.
- Every user-visible control must correspond to an authorized action. A shell
  or read-only phase has no action control.
- Accessibility and clear unavailable states are product requirements.

## Delivery check

Confirm the changed files stay inside the authorized frontend/documentation
scope and explicitly report any guardrail that prevented an implementation
choice.
