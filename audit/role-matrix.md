# Role matrix - access to Salon A data (real calls against the test project)

Target rows belong to **Salon A**. Personas: anon (visitor), X (member of no salon, registered), A (owner A), A1/A2 (staff of A), B (owner of the OTHER salon).

Legend: `✓N` allowed (N rows affected/visible) · `·0` no error but 0 rows (filtered by RLS = effectively denied) · `✗` rejected.

This reflects the state **after** the fixes (`0001_audit_hardening.sql` applied). It is produced by `audit/tests/role-matrix.test.ts`.

### `salons`

| Operation | anon (visitor) | X (no salon) | A (owner A) | A1 (staff A) | A2 (staff A) | B (owner B) |
|---|---|---|---|---|---|---|
| select(A) | ✗ | ·0 | ✓1 | ✓1 | ✓1 | ·0 |
| update(A) | ✗ | ·0 | ✓1 | ·0 | ·0 | ·0 |
| delete(A) | ✗ | ·0 | ✓1 | ·0 | ·0 | ·0 |

### `staff`

| Operation | anon (visitor) | X (no salon) | A (owner A) | A1 (staff A) | A2 (staff A) | B (owner B) |
|---|---|---|---|---|---|---|
| select(A) | ✗ | ·0 | ✓3 | ✓3 | ✓3 | ·0 |
| insert(A) | ✗ | ✗ | ✓1 | ✗ | ✗ | ✗ |
| update(A) | ✗ | ·0 | ✓3 | ·0 | ·0 | ·0 |
| delete(A) | ✗ | ·0 | ✓2 | ·0 | ·0 | ·0 |

### `services`

| Operation | anon (visitor) | X (no salon) | A (owner A) | A1 (staff A) | A2 (staff A) | B (owner B) |
|---|---|---|---|---|---|---|
| select(A) | ✗ | ·0 | ✓2 | ✓2 | ✓2 | ·0 |
| insert(A) | ✗ | ✗ | ✓1 | ✗ | ✗ | ✗ |
| update(A) | ✗ | ·0 | ✓2 | ·0 | ·0 | ·0 |
| delete(A) | ✗ | ·0 | ✓2 | ·0 | ·0 | ·0 |

### `customers`

| Operation | anon (visitor) | X (no salon) | A (owner A) | A1 (staff A) | A2 (staff A) | B (owner B) |
|---|---|---|---|---|---|---|
| select(A) | ✗ | ·0 | ✓1 | ✓1 | ✓1 | ·0 |
| insert(A) | ✗ | ✗ | ✓1 | ✗ | ✗ | ✗ |
| update(A) | ✗ | ·0 | ✓1 | ·0 | ·0 | ·0 |
| delete(A) | ✗ | ·0 | ✓1 | ·0 | ·0 | ·0 |

### `bookings`

| Operation | anon (visitor) | X (no salon) | A (owner A) | A1 (staff A) | A2 (staff A) | B (owner B) |
|---|---|---|---|---|---|---|
| select(A) | ✗ | ·0 | ✓1 | ·0 | ·0 | ·0 |
| update(A) | ✗ | ·0 | ✓1 | ·0 | ·0 | ·0 |
| delete(A) | ✗ | ·0 | ✓1 | ·0 | ·0 | ·0 |

### `customer_notes`

| Operation | anon (visitor) | X (no salon) | A (owner A) | A1 (staff A) | A2 (staff A) | B (owner B) |
|---|---|---|---|---|---|---|
| select(A) | ✗ | ·0 | ✓1 | ✓1 | ✓1 | ·0 |
| update(A) | ✗ | ·0 | ·0 | ·0 | ·0 | ·0 |
| delete(A) | ✗ | ·0 | ✓1 | ·0 | ·0 | ·0 |

_Note: `select(A)` for anon is DIRECT table access; public reads happen only through the `get_public_salon`/`get_busy_times` RPCs (separate tests). Staff (A1/A2) see `·0` for `bookings` because the seeded booking belongs to the owner and staff now see only their own._
