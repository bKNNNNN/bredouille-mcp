# Contributing

Thanks for helping. Bug reports, fixes and wording improvements are welcome.

- Open an issue first for anything bigger than a small fix, so we can agree on the approach.
- `npm ci`, then `npm run check` (typecheck, lint, tests) must pass. `npm run smoke` runs the Worker in workerd against the live API.
- Add or update a test with every behaviour change. Tests use mocked fetch and the fixtures in `test/fixtures/`; never call the live API from `npm test`.
- User-facing text is French. No em dashes, typographic apostrophes (’), a non-breaking space before « : ; ? ! » and inside « ».
- Never weaken the safety rules: every answer ends with the safety line, nothing says a mushroom is edible, nothing identifies a mushroom, and no answer returns the coordinates of a user's place.
- Commits follow `type: summary` (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `perf`).

By contributing you agree that your contribution is licensed under the MIT licence of this repository.
