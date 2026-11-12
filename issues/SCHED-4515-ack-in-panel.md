---
id: SCHED-4515
title: Ack moves from the row into an incident panel
status: done
plan: R2 (changed by D1)
---

Product decision D1 (2026-11-12), after the step-1 recording showed a wrong ack at 00:12: new incidents stay live at
the top; Ack leaves the row; a row opens its incident panel, and Ack lives there.

- A click, Enter or Space on a row opens the incident panel (`data-testid="incident-panel"`) for that row. The panel
  names the incident id, its severity, service, region, summary and opened time.
- The panel's Ack (`data-testid="panel-ack"`, labelled "Ack <id>") acks the incident the panel names, not a list
  position. The row then shows `data-testid="acked"`; the panel shows when it was acked.
- Rows have no Ack button (`data-testid="ack"` removed). New incidents still go in at the top live (R1), and no row is
  rebuilt or removed by a refresh.
- Escape or × closes the panel.

Acceptance: if a new incident lands while on-call clicks, the panel names the incident that was really opened, so
on-call sees the mismatch before anything is acked; the panel's Ack acks exactly the incident the panel names.
