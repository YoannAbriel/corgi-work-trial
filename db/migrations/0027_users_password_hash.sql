-- 0027: a user created by the operations team carries their own password hash.
-- Strictly additive: one NULLABLE column on users and two INSERT grants. Nothing from 0001 to
-- 0026 is dropped or altered, and no existing column changes meaning.
--
-- WHY. Until this slice every account of this build shared DEMO_PASSWORD (lib/auth/session.ts,
-- passwordMatches), because every account came from the seed script. POST /api/brokers now lets
-- staff operations create a broker from the screen, and that broker gets a one-time password
-- shown once to the operator. That password has to be checked against something, and the shared
-- demo password is not it.
--
-- WHAT THE COLUMN MEANS, and it never means anything else:
--
--   NULL      a seeded demo user of this build. The shared DEMO_PASSWORD still applies to them,
--             exactly as before this migration, so every seeded account signs in unchanged;
--   NOT NULL  a scrypt hash written by lib/auth/password.ts for a user created through
--             POST /api/brokers. The shared demo password does NOT open that account.
--
-- The column is nullable because the table already holds rows and we cannot invent a password
-- for them. It is never filled in for an existing row: a user keeps the meaning it was created
-- with (see MEMORY note "never redefine a column").
alter table users add column if not exists password_hash text null;

comment on column users.password_hash is
  'null means the shared demo password of this build still applies (seeded users); a non-null value is a scrypt hash for a user created through POST /api/brokers';

-- THE TWO GRANTS. The runtime role (app_runtime) had SELECT only on brokers and users
-- (migration 0002, line 264), because until now nothing in the application created either: the
-- seed script creates them with the owner connection. POST /api/brokers does, so the role needs
-- INSERT on both, in the same transaction.
--
-- INSERT ONLY, deliberately. No UPDATE and no DELETE is granted here, so:
--   - brokers keeps its append-only trigger (migration 0002, brokers_are_append_only) AND has no
--     grant that could reach it, which is two independent reasons a broker row cannot change;
--   - a user row cannot be rewritten by the application either, so a password hash cannot be
--     swapped for another one through any route of this build.
grant insert on brokers, users to app_runtime;
