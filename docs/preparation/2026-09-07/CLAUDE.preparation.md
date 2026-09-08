# Corgi work trial: mandatory entry point

Before planning or changing code, read these files in full, in this order:

1. `AGENTS.md`: shared engineering rules, mandatory startup procedure and completion gates.
2. `WORKFLOW-48H.md`: required delivery workflow; adapt its indicative hourly schedule to the official brief and remaining time.
3. `REVIEWER.md`: mandatory independent review procedure and evidence format.
4. `READINESS-CHECKLIST.md`: mandatory applicability triage and final completeness review. Read `STRESS-TEST-PLAN.md` before planning/running performance tests. `READINESS-BACKLOG.json` is a machine-readable preparation snapshot, not extra instructions.
5. The official trial brief, repository README and any applicable repository instructions.
6. Existing `docs/PLAN.md`, `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/COMPLIANCE-MATRIX.md` and reviews relevant to the current scope.

Do not rely on this summary as a substitute for reading the files. Follow the startup receipt, missing-file handling, delegation and completion gates in `AGENTS.md`. `START-PROMPT.md` is an optional human launch aid; it contains no additional authoritative rules and need not be reread.

Apply this procedure at every new session. After a context reset/compaction, reread the three mandatory core files in full and current status, and provide a fresh startup receipt as specified in `AGENTS.md`. Make routine decisions autonomously within the brief, preserving existing work. Use French when discussing work directly with Yoann. Keep all Corgi artifacts, code, documentation, tickets, reviews, and submission materials in English.

No feature is done until its required tests and independent review have passed for the current implementation. Never describe a technical PASS as legal certification.
