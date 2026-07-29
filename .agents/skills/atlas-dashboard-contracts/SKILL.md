---
name: atlas-dashboard-contracts
description: Create or consume ATLAS Dashboard read-model contracts safely. Use for @atlas/contracts, coordinator Dashboard GET responses, frontend data access, Zod schemas, and contract tests.
---

# ATLAS Dashboard Contracts

Use this skill whenever backend data crosses into the Dashboard frontend.

## Contract workflow

1. Inspect the real coordinator read model and its serialized HTTP shape.
2. Model only public, workflow-relevant fields in a strict Zod schema.
3. Validate at the frontend boundary and infer TypeScript types from the schema;
   do not maintain a parallel handwritten interface.
4. Preserve serialized dates as ISO strings and explicit unavailable states.
5. Test the schema against a response produced by the real service, after JSON
   serialization.
6. Add a negative test proving unexpected sensitive fields are rejected.

## Safety rules

- Contracts do not move business logic into the frontend.
- Do not widen a backend response just to satisfy a component.
- Exclude prompts, raw LLM content, payloads, `messageText`, destinations,
  secrets, credentials, and chain-of-thought.
- Missing, malformed, or unrecognized data fails closed at the boundary; it
  does not become invented progress or a successful status.
- Keep the coordinator as the canonical backend and Postgres as the existing
  source of truth.

## Review evidence

Report the exact service method exercised, the serialized contract result, and
the negative sensitive-field probe.
