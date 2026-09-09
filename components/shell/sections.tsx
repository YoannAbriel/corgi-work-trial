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

export const SECTIONS: Record<SectionId, SectionDefinition> = {
  home: { label: "Overview", icon: Home, illustration: "welcome-corgi" },
  console: { label: "Console", icon: Activity, illustration: "engineer-corgi" },
  ledger: { label: "Ledger", icon: BookOpenText, illustration: "open-ledger" },
  search: { label: "Search", icon: Search, illustration: "magnifying-glass" },
  infra: { label: "Infrastructure", icon: ServerCog, illustration: "server-box" },
  inbox: { label: "Inbox", icon: Inbox, illustration: "in-tray" },
  policies: { label: "Policies", icon: FileText, illustration: "open-folder" },
  verification: { label: "Brokers", icon: ShieldCheck, illustration: "broker-corgi" },
  claims: { label: "Claims", icon: WalletCards, illustration: "umbrella" },
  approvals: { label: "Approvals", icon: ClipboardCheck, illustration: "checker-corgi" },
  reconciliation: { label: "Reconciliation", icon: Scale, illustration: "balance-scales" },
  statements: { label: "Statements", icon: ReceiptText, illustration: "accountant-corgi" },
  "mcp-keys": { label: "MCP keys", icon: KeyRound, illustration: "key-ring" },
  login: { label: "Sign in", icon: LogIn, illustration: "welcome-corgi" },
};
