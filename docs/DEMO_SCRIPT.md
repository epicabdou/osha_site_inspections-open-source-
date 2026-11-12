# Demo script (2 minutes)

A walkthrough for recording the README GIF or a short video. It tells the project's story: an
inspector with no signal, a critical failure, a supervisor changing things in the meantime, and
everything reconciling correctly.

## Setup (before recording)

- Two browser profiles side by side (for example Chrome and a Chrome guest window), both at the
  same zoom, each about half the screen. Left: **inspector**. Right: **supervisor**.
- Left: open `/field?demo=1` and sign in as the demo inspector. Wait for the badge to say
  **All synced** (the checklists have downloaded). Open **Demo controls** once so viewers see it.
- Right: open `/dashboard` and sign in as the demo supervisor. The seeded inspection at
  **Plant room B2** is already there, with an open critical finding.

## Script

| Time | Left: inspector                                                                                                              | Right: supervisor                                                                                                      | Say                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 0:00 | —                                                                                                                            | Overview: one open critical finding, one inspection.                                                                   | "A supervisor's view: findings first, then every inspection."                            |
| 0:10 | In **Demo controls**, tick **Force offline**. The badge says **Offline**.                                                    | —                                                                                                                      | "The inspector walks into a basement plant room. No signal."                             |
| 0:20 | **Start an inspection** → site _Plant room B2_ → _Scaffold pre-use inspection_ → **Start inspection**.                       | —                                                                                                                      | "Starting an inspection needs no network: it gets its id on the device."                 |
| 0:30 | Answer the first section: **Pass**, **Pass**, **N/A**. Each item says **Saved on device**; the badge counts what is waiting. | —                                                                                                                      | "Every tap is saved on the device at once, as a permanent event."                        |
| 0:45 | **Platform and edges** → guardrail height **820** → **Save**. A red banner: _Critical item failed…_                          | —                                                                                                                      | "A critical item fails. The flag appears immediately, without the server."               |
| 0:55 | Add a note and **Take photo** (or choose one). The thumbnail says **Waiting to upload**.                                     | —                                                                                                                      | "Photos are compressed and stripped of location on the device, then wait for bandwidth." |
| 1:05 | —                                                                                                                            | The **Inspections** list: nothing new yet.                                                                             | "The supervisor sees nothing: the inspector is still offline."                           |
| 1:15 | Untick **Force offline**. Watch the queue table drain; the badge goes to **All synced**.                                     | —                                                                                                                      | "Back in coverage, the outbox drains on its own, in order, safely retried."              |
| 1:30 | —                                                                                                                            | The dashboard refreshes (every 15 s): the new inspection with a **Critical** badge, and a new open finding at the top. | "The server turned the critical fail into a corrective action."                          |
| 1:40 | —                                                                                                                            | Open it: the guardrail answer with its history (device time and server time side by side) and the photo.               | "Every answer keeps its full history: the audit trail."                                  |
| 1:50 | —                                                                                                                            | Close the corrective action with a note.                                                                               | "Only a supervisor closes it, with a note. A later pass would not."                      |
| 2:00 | —                                                                                                                            | —                                                                                                                      | "Offline-first, conflict-safe, and every step is tested."                                |

## Optional extras (if there is time)

- **Rejection:** force the inspector offline, cancel the inspection from the dashboard (a reason is
  required), keep answering, then go back online. The new answers show **Rejected** with the reason,
  and a banner explains the inspection was cancelled. Nothing is lost: **Export local data as JSON**.
- **Conflict:** open a third profile as the same inspector, answer the same item differently on two
  devices while both are offline, reconnect both. Both apps and the dashboard flag
  **Conflicting answers**, and the history keeps both entries.
- **Clock skew:** set **Clock skew** to +2 h on one device. A quiet notice says the clock looks
  wrong, and the history order stays correct.
- **Flaky network:** set **Drop rate** to 50% and **Latency** to 2 s, then answer a few items. The
  queue table shows attempts climbing and entries draining as requests get through.
