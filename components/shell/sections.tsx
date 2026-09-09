import {
  Activity,
  BookOpenText,
  ClipboardCheck,
  FileText,
  Home,
  Inbox,
  KeyRound,
  LogIn,
  ReceiptText,
  Scale,
  Search,
  ServerCog,
  ShieldCheck,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { IllustrationName } from "@/components/decorative-illustration";

// The sections of the workspace, named once. A section is what the main sidebar lists and what
// the page band shows the reader they are in: its label, its icon and its illustration are
// the same on the sidebar, in the band and on the overview cards, which is how a reader knows
// where they are without reading the title.
export type SectionId =
  | "home"
  | "console"
  | "ledger"
  | "search"
  | "infra"
  | "inbox"
  | "policies"
  | "verification"
  | "claims"
  | "approvals"
  | "reconciliation"
  | "statements"
  | "mcp-keys"
  | "login";

export type SectionDefinition = {
  label: string;
  icon: LucideIcon;
  illustration: IllustrationName;
};

// Cycle 2, decision 12: every section is a watercolour corgi doing that work. The monochrome
// objects that used to sit here (an in-tray, a folder, scales, a server box) were drawn at 40 to
// 52 px behind a radial mask and read as dark smudges; they stay available in
// components/decorative-illustration.tsx for the empty states that use them at 200 px.
//
// Same reason for inbox, search and MCP keys: their first corgi was a dark tricolour drawn small
// in its frame, which the 52 px band turned back into a smudge. A courier with a parcel, an
// explorer with a map and an electrician with a cable are light, fill the frame, and each says
// what the section does: post arriving, finding a reference, connecting a client.
export const SECTIONS: Record<SectionId, SectionDefinition> = {
  home: { label: "Overview", icon: Home, illustration: "welcome-corgi" },
  console: { label: "Console", icon: Activity, illustration: "laptop-corgi" },
  ledger: { label: "Ledger", icon: BookOpenText, illustration: "reading-corgi" },
  search: { label: "Search", icon: Search, illustration: "explorer-corgi" },
  infra: { label: "Infrastructure", icon: ServerCog, illustration: "mechanic-corgi" },
  inbox: { label: "Inbox", icon: Inbox, illustration: "courier-corgi" },
  policies: { label: "Policies", icon: FileText, illustration: "archivist-corgi" },
  verification: { label: "Brokers", icon: ShieldCheck, illustration: "broker-corgi" },
  claims: { label: "Claims", icon: WalletCards, illustration: "umbrella-corgi" },
  approvals: { label: "Approvals", icon: ClipboardCheck, illustration: "checker-corgi" },
  reconciliation: { label: "Reconciliation", icon: Scale, illustration: "researcher-corgi" },
  statements: { label: "Statements", icon: ReceiptText, illustration: "accountant-corgi" },
  "mcp-keys": { label: "MCP keys", icon: KeyRound, illustration: "cable-corgi" },
  login: { label: "Sign in", icon: LogIn, illustration: "welcome-corgi" },
};
