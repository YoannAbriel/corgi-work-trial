import type postgres from "postgres";
import { sql } from "@/db/client";
import type { UserRole } from "@/lib/auth/current-user";

// An operator says what a reconciliation break is (decision by Yoann, 2026-09-09).
//
// What the user does: on /ops/reconciliation, a staff operations user writes one or two sentences
// under a break and presses "Explain this break". This file checks who they are and what they
// wrote, and appends one row to reconciliation_break_notes (migration 0022).
//
// WHAT EXPLAINING DOES NOT DO, and it is the whole reason this file is short: it repairs nothing.
// No money moves, no journal entry is posted, no reconciliation row is edited or deleted, no
// provider is called. The break is still compared by every later run exactly as before, and it
// stays on the screen, under "Explained breaks", with the note. The one thing that changes is
// that it leaves the list of breaks TO ACT ON and the operations inbox
// (lib/reconciliation/read.ts, IT_IS_A_BREAK_TO_ACT_ON), because a human has looked at it.
//
// A CORRECTION IS A NEW NOTE. The table is append-only, so a note is never edited: writing a
// second one leaves both on file and the screen shows the latest, saying how many there are.

// The same bounds as the CHECK constraint of migration 0022, named once so the form, the server
// and the database all say the same thing.
export const NOTE_MINIMUM_CHARACTERS = 10;
export const NOTE_MAXIMUM_CHARACTERS = 500;

// A refusal a person can act on: the wrong role, a note that is too short or too long, a break
// key no run has ever reported. It becomes a message on the screen, never a 500.
export class BreakNoteRefused extends Error {}

export type ExplainBreakInput = {
  breakKey: string;
  note: string;
  actor: { userId: string; role: UserRole };
};

// Staff OPERATIONS only, and not staff approvers: an approver's job is to decide money-out
// requests somebody else made, and reconciliation is operations work. Every other role
// (broker, customer, agent) is refused by the same allowlist, so a role added later is refused
// by default rather than by being forgotten here.
export async function explainBreak(
  input: ExplainBreakInput,
  database: postgres.Sql = sql,
): Promise<{ noteId: string }> {
  if (input.actor.role !== "staff_ops") {
    throw new BreakNoteRefused("only staff operations can explain a reconciliation break");
  }

  // Trimmed before it is measured, so a note of spaces cannot pass the minimum.
  const note = input.note.trim();
  if (note.length < NOTE_MINIMUM_CHARACTERS) {
    throw new BreakNoteRefused(
      `write at least ${NOTE_MINIMUM_CHARACTERS} characters saying what this break is`,
    );
  }
  if (note.length > NOTE_MAXIMUM_CHARACTERS) {
    throw new BreakNoteRefused(`a note is at most ${NOTE_MAXIMUM_CHARACTERS} characters`);
  }

  // The break key comes from a form, so it is checked against what the runs actually reported
  // rather than trusted. Without this, a note could be filed under a key nothing will ever show,
  // and it would sit in an append-only table for ever explaining nothing.
  const [reported] = await database<{ break_key: string }[]>`
    select break_key
      from reconciliation_items
     where break_key = ${input.breakKey}
       and classification <> 'matched'
     limit 1
  `;
  if (!reported) {
    throw new BreakNoteRefused("no reconciliation run has ever reported this break");
  }

  const [row] = await database<{ id: string }[]>`
    insert into reconciliation_break_notes (break_key, note, explained_by)
    values (${input.breakKey}, ${note}, ${input.actor.userId})
    returning id
  `;
  return { noteId: row.id };
}
