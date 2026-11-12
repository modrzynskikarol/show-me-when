# sched-prod incident board — plan

The on-call board for sched-prod. One page, one list: tonight's incidents, newest first, so on-call sees
what just broke and takes it.

## Flows

| flow | who | what happens |
|------|-----|--------------|
| `open-board` | on-call | opens the board; sees tonight's incidents |
| `ack-incident` | on-call | picks an incident on the board, which opens its panel, and acks it there — "I've got this one" |
| `watch-board` | on-call | keeps the board open; it stays current without a reload |

## Requirements

- **R1** New incidents appear live at the top of the list, newest first.
- **R2** ~~Each incident row has an **Ack** button.~~ *Changed 2026-11-12 by product (see Decisions, D1).* A click (or
  Enter/Space) on an incident row opens its **incident panel**. The panel names the incident id, and its **Ack** sends
  the ack for the incident the panel names (`api.ack(id)`), then marks the row and the panel acked. Rows have no Ack button.
- **R3** Show a loader until incidents load.
- **R4** The board refreshes itself every 2 seconds while open.
- **R5** Times show in the viewer's local time; day before month for EU locales (dd/mm).
- **R6** The page names its build: `<meta name="build" content="<git sha>">` in the head and the same sha in the footer.

## Hooks (pinned — tests and the replay rely on them)

| `data-testid` | element |
|---------------|---------|
| `board` | the board's main area |
| `loader` | the loader (gone once incidents load) |
| `empty` | what shows when there are no incidents |
| `incident-list` | the list |
| `incident-row` | one incident row, with `data-id="<incident id>"` |
| ~~`ack`~~ | ~~the Ack button in a row~~ — removed by D1 |
| `acked` | the acked mark in a row |
| `build-sha` | the sha in the footer |
| `incident-panel` | the incident panel, naming the incident id (added by D1) |
| `panel-ack` | the Ack button in the panel (added by D1) |

## Decisions

- **D1 (2026-11-12, product).** Evidence: step-1 recording at 00:12 — the pointer was on INC-1179's Ack, INC-9993
  landed at the top, and the click acked INC-9993. Decision, as product wrote it: "New incidents stay live at the top.
  Ack leaves the row: a row opens its incident panel, and Ack lives there." R1 stays; R2 changes; hook `ack` goes,
  hooks `incident-panel` and `panel-ack` come in. Delivered by SCHED-4515.

## Done

Every issue in `issues/` delivered, deployed to a public https address, and shown working.
