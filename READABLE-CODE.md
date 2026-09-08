# Readable code and candidate ownership

Yoann's explicit requirement: keep implementation readable for someone whose strongest skill is not writing low-level application code. Code must support a line-by-line debrief. These are user workflow safeguards supporting AF-06, not extra official scoring criteria.

## Write code that can be followed directly

- Choose a familiar stack and the smallest architecture that meets the actual brief. State a proposal and its reasons; do not describe it as Yoann's choice without his acceptance.
- Prefer explicit business operations and straightforward control flow. Avoid generic workflow engines, custom dependency injection frameworks, metaprogramming, clever one-liners, deep inheritance and speculative adapters. Use a small provider interface only where live/simulated implementations or recovery actually need it.
- Give each function one business responsibility. Split when explaining it requires jumping between unrelated concerns, not to satisfy an arbitrary line limit. Keep related facts together instead of scattering a simple flow across many tiny files.
- Use descriptive English names with units and purpose: `amountCents`, `effectiveAt`, `recordedAt`, `providerEventId`, `releaseAuthorizationHold`. Avoid ambiguous `data`, `value`, `process` or single-letter variables in business logic.
- Make types, lifecycle states and allowed transitions explicit. Distinguish money, security units, percentages, dates and IDs. Readability cannot justify floats, missing transactions, in-memory-only deduplication or a mutable money row.
- Separate pure financial calculations from persistence and provider calls. Make rounding, dates and residual-cent allocation explicit. Explain the chosen formula with a small hand-worked example beside its tests or in the feature note.
- Show failure paths in the code: invalid request, unauthorized actor, declined/unknown provider outcome, retry and reconciliation break. Do not swallow errors, use broad catches that return success, or hide side effects in helpers with misleading names.
- Comments explain business reasons, constraints and non-obvious choices. Do not narrate every assignment or use comment volume to disguise convoluted code. Keep important explanations close to the code they describe.
- Use documented third-party libraries for provider/security functionality rather than handwritten cryptography or parsers. Yoann must understand the boundary, assumptions and relevant calls; this does not require reimplementing library internals.

## Teach in each vertical slice

Before implementation: state the user action, expected money/state changes, forbidden outcomes and smallest design in plain language. Add one numeric example when money is involved.

After implementation, provide a short explanation in French in conversation, with English repository notes where useful:
1. What the user does and which entry point receives it.
2. The small set of files/functions to read in order.
3. What is persisted, what leaves for a provider and what arrives by webhook.
4. Why a replay, crash, concurrent request or correction cannot create the wrong financial effect.
5. Which tests demonstrate those claims and what remains unverified.

Do not generate large unreviewed batches of code that accumulate an understanding debt. At each completed slice, give Yoann an opportunity to identify unclear parts. If he says a part is unclear, explain it with a concrete example and simplify it where that preserves correctness. Never label human understanding as confirmed merely because an explanation was sent or an automated test passed.

## Review and handoff

The independent reviewer checks whether the implementation can be traced with a short reading path and flags unnecessary indirection, ambiguous units, hidden side effects and opaque financial math. Review financial correctness separately; aesthetically simple code can still be wrong.

Keep human walkthrough status separate from technical review status: `NOT REVIEWED WITH YOANN`, `QUESTIONS OPEN`, or `EXPLAINED AND CONFIRMED BY YOANN`, with actual evidence. Only record confirmation when Yoann actually provides it. Routine work may continue while a walkthrough is pending; a final claim that he can defend the code cannot.

Before submission, rehearse the core money path and hostile cases using actual code. Yoann should explain the important lines in his own words, including transaction boundaries, idempotency, money arithmetic, eligibility and approval checks. Reduce optional code that cannot be understood within the remaining time; do not remove mandatory behavior or hide a gap. Track selection is still open.
