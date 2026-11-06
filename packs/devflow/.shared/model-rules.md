# Models: the smallest model for each phase

These rules replace the model wording of `knowledge/plan-method.md` ("Sonnet worker sessions", "Sizing
for Sonnet" as a model choice, `worker_model: opus`). Every other "Sizing for Sonnet" rule still applies to every
phase: complexity S or M, no open decisions in a brief, numbered steps naming files and symbols,
mechanical acceptance, honest `touches` disjoint within a wave, a stop condition for each risky
step. Never write `worker_model` in the manifest.

1. Every phase has `model: small`, `model: medium` or `model: large`, the Archon tier its worker
   runs on. It is picked once, here: nothing escalates it at run time, and a phase that ends
   blocked stops the run.
2. `small` is the default. Make each brief mechanical enough for it: every file, symbol, name,
   string and test is spelled out in the brief or in a named Design subsection, or the brief names
   a commit to copy by SHA. Split a phase rather than raise its model.
3. `medium` only when the phase cannot be made mechanical for small even after splitting: it must
   adapt non-trivial existing logic across several files, write new logic whose exact code the plan
   cannot spell out (parsing, state handling, an algorithm), or write prompt or documentation prose
   whose wording the plan does not give.
4. `large` only where a mistake is costly and the acceptance cannot catch it: subtle concurrency,
   or security-sensitive code (authentication, authorization, secrets, cryptography, sandboxing,
   input parsing at a trust boundary).
5. `model_reason` (one sentence: which of rules 3 or 4 applies, and why) is required for `medium`
   and `large`. Leave it out for `small`.
6. The manifest's top-level `review_model` is the final build review's tier. It is `large` when
   the change is security-related (rule 4's areas, or the work is a security fix), or any phase has
   `model: large`, or `phases` has 7 or more entries (the retirement phase counts). Otherwise it is
   `medium`. `review_model_reason` (always required) says which applies, with the phase count.
7. plan.md has a `## Phases and models` section: in a large-scope plan directly after `## Design`,
   in a small-scope plan directly after `## Stop conditions`. It holds a table
   `| Phase | Title | Complexity | Depends on | Model | Why this model |` with one row per manifest
   phase in manifest order (`—` for no dependencies, `default` as the reason of a `small` row),
   then the line `Final build review: **<review_model>**. <review_model_reason>`.

