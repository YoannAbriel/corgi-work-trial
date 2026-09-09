# UI system: the brief every screen builder follows

Written 2026-09-09 by the interface session for the builders of branch `ui-system`. Read it after `AUTOMATIC-FAILS.md`, `READABLE-CODE.md` and `AGENTS.md`. Yoann's decision of 15:15 Europe/Zurich: every screen is rebuilt on one system; colours, buttons and fonts stay; nothing under `lib/`, `db/`, `app/api` or `scripts/` changes, and every form keeps its `action`, its `method` and its field names.

## What already exists (read these files first)

| File | What it gives you |
|---|---|
| `app/styles/system.css` | every class named below; read it once, do not add rules to it (ask the coordinator) |
| `components/shell/app-shell.tsx` | `PortalShell` with `band`, `views`, `inspector`, `toasts` |
| `components/shell/sections.tsx` | the sections, their icons and illustrations (`SectionId`) |
| `components/ui/stat.tsx` | `Stats`, `Stat` |
| `components/ui/charts.tsx` | `Chart`, `ChartRow`, `Bars`, `StackedBars`, `HBars`, `Donut`, `Sparkline`, `Swatch`, `CHART_COLORS` |
| `components/ui/table.tsx` | `DataTable`, `Row`, `Primary`, `Num`, `Chevron`, `Ref`, `ExpandRow`, `ExpandHead`, `FactGrid`, `EntryLines`, `RowMenu`, `MoreRows` |
| `components/ui/toolbar.tsx` | `Toolbar`, `ToolbarGroup`, `FilterChip`, `ToolbarSpacer`, `ToolbarCount` |
| `components/ui/popover.tsx` | `PopoverButton`, `PopoverPanel` (native popover, top layer) |
| `components/ui/inspector.tsx` | `Inspector` (staff only, `?inspect=<ref>`) |
| `components/ui/time.tsx` | `When` (age at a glance, UTC on hover) |
| `components/ui/legend.tsx`, `about.tsx`, `empty.tsx` | `Legend`, `About`, `EmptyState` |
| `components/ui/toast.tsx`, `submit-button.tsx` | `Toaster` (used by the shell), `SubmitButton` |
| `lib/ui/views.ts` | `pickView`, `pickFilter`, `firstValue`, `withParams`, `inspectHref`, `closeInspectorHref`, `inspectedReference`, `toastsFromQuery`, `relativeAge`, `utcInstant` |
| `app/ops/page.tsx`, `components/workspace-overview.tsx` | reference screen: band, tiles, cards, welcome, About |
| `app/ops/policies/page.tsx` | reference screen: band, tiles, toolbar with filter chips and search, standard table, legend, About |

Legacy blocks you may still use: `Chip` from `components/detail-layout.tsx` (statuses), `Disclosure` and `SandboxReferences` from `components/disclosures.tsx` (inside an expansion row only), `JournalTable`, `AmountExplained`, `MoneyAmountInput`, `Masked`, `IntegrationModes`.

## The shape of a rebuilt screen

```tsx
<PortalShell user={user} active="reconciliation" band={{ title, suffix, meta, actions }} views={views} toasts={toasts} inspector={inspector}>
  <Stats>…</Stats>                // 2 to 5 tiles, the figures a reader wants first
  <ChartRow>…</ChartRow>          // 0 to 2 charts, only when the figure has a shape
  <DataTable toolbar legend>…</DataTable>   // 4 to 6 columns
  <About>…</About>                // every explanation, at the bottom, closed
</PortalShell>
```

- **Views.** `const VIEWS = ["breaks", "runs"] as const; const view = pickView(query.view, VIEWS);` then `views={VIEWS.map(v => ({ key: v, label, href: withParams(PATH, query, { view: v, inspect: null }), current: v === view, count }))}`. Render only the current view. A sibling route (search, infra) is a view whose `href` is that route.
- **Band.** Title of 1 to 4 words; `suffix` for the one fact that identifies the record (customer name, broker name); `meta` holds 2 to 4 `Chip`s: status, the key amount, the AF-02 mode chips (`Stripe: LIVE SANDBOX`, `claim rail: LOCAL SIMULATOR` when a rail record is on the page), a count; `actions` holds the primary buttons. A primary action is never folded (F-YA-05).
- **Toasts.** `const toasts = toastsFromQuery(query, { error: { tone: "error", title: "Refused" }, ran: { tone: "ok", title: "Reconciliation finished" } })` with every redirect parameter the routes send to this page. Keep the inline `<p className="error" role="alert">` in a `.notices` block as well: the review scripts read it.
- **Inspector.** On staff screens with references: `const inspected = inspectedReference(query.inspect); inspector={inspected ? <Inspector reference={inspected} closeHref={closeInspectorHref(PATH, query)} user={user} now={now} /> : undefined}` and in the table `<Ref value={ref} inspectHref={inspectHref(PATH, query, ref)} open={inspected === ref} />`. Never on broker or customer screens.
- **Tables.** At most six columns. `Row href` makes the row one link; `Primary` is the record's name; `Num` for money and counts; `When` for instants; a `Chip` for a status; `Chevron` last when the row opens somewhere. What does not fit goes in an `ExpandRow` (facts as `FactGrid`, journal lines as `EntryLines`, references as `SandboxReferences`), never a second table inside a cell. Secondary row actions go in `RowMenu` (native popover); the primary one stays a small visible button. A long table is bounded at 50 rows with `MoreRows` linking to `?all=1`.
- **Charts.** Only when the figure has a shape: a split (Donut), a trend (Bars, Sparkline), a comparison (HBars, StackedBars). Values arrive computed on the server from rows already read; no new query for a picture.
- **Empty states.** `EmptyState` with an illustration from `components/decorative-illustration.tsx` (see the map there) and one sentence.
- **Legend.** One definition per classification or status, once, under the table.

## Writing rules (Yoann, 15:15: "trop verbeux, pas assez snappy")

- Labels of 1 to 3 words. The figure before the text. Sentences of 12 words at most on a screen.
- A status is one word in a chip. An instant is `When` (age at a glance, UTC in `title`). Money is `formatCentsAsUsd`.
- No sentence in a table cell. No paragraph between a heading and its table. Every explanation goes in `About`, under short `<h4>` headings.
- A calculation reads as one line ("$1,200.00 × 2.35 % = $28.20"); the detail stays behind `AmountExplained`.
- AF-02 wording stays exact and visible: `Stripe: LIVE SANDBOX`, `LOCAL SIMULATOR` on every simulated record, `IntegrationModes` on every console screen.
- No em dash, no en dash, anywhere. No emoji.

## What must not change

- `redirect()` and `notFound()` stay above any markup; no `loading.tsx` (app/layout.tsx says why).
- Forms: same `action`, `method`, field `name`s and hidden inputs. Use `SubmitButton` for the submit of a form that posts; `className` as before.
- Inbox anchors (`lib/inbox/sections.ts`) and the ids the checks assert.
- Every figure: the 30 figures measured on CGP-01707 and CGP-01274 by the UI reviewer must print the same.
- `components/amount-explained-motion.tsx` logic and tests; `money-amount-input.tsx`; `journal-table.tsx`.

## How you work

- In your own worktree on a branch cut from `ui-system`; never touch `/Users/yoannabriel/dev/corgi-work-trial` (the shared checkout) or `main`.
- Only the files assigned to you. If you need a rule in `system.css` or a change to a shared component, write it in your notes and tell the coordinator; do not edit those files.
- `npm run typecheck` and `npm run build` green before you report. Take screenshots of every screen you touched at 1440 px with the scratchpad script (`node shoot.mjs` with `BASE=http://localhost:<port>`), signed in with the role that owns the screen, and look at them.
- Report: files touched, screens and views, the checks you ran with their output, what you could not verify, and the reading path of your code in five lines.
