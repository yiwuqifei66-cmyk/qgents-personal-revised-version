# Mock fixtures

Mock handlers live in `src/mocks/handlers` and fixture data belongs in this
directory when a feature needs it. Components must call the same API modules
as production code; they must not import fixture data directly.

The task model fixtures support the following scenarios through the optional
`scenario` query parameter: `PLANNING`, `PENDING`, `RUNNING`, `SUCCEEDED`,
`FAILED`, `CANCELLING`, `CANCELLED`, and `EMPTY`.

Use `?error=FORBIDDEN` or `?error=INVALID` on a task-model request to verify
the `403` permission and `422` validation error paths.

State transitions are implemented separately in
`src/mocks/task-model/stateTransitions.ts` so they can be tested without a
browser or a page.
