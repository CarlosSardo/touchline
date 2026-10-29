---
title: Time, careers and saves
description: Advance safely, understand seasonal changes and manage snapshots without losing a career.
---

# Time, careers and saves

## Continue is the simulation clock

The selector beside **Continue** offers 1 day, 1 week, 2 weeks and 4 weeks. Simulation speed in Settings chooses the default interval: deliberate is one day, balanced seven and fast 28. It does not give you live match control.

Advancing processes the whole world, not only your next fixture. Negotiations progress, scouting finishes, offers arrive, injuries recover, international squads assemble, registrations are reviewed, clubs trade, matches play and loans finish. Weekly updates handle development and accounts. Seasons roll over on 1 July.

**Advice:** use single days near deadlines, contract decisions, scheduled arrivals or important event responses. Longer intervals suit a settled period only after you have checked the work queue. Do not assume a four-week advance will pause to ask you about every offer.

## Partial progress is real progress

Each simulated day commits separately. If a multi-day Continue fails after several days, the already-completed days stay played. The response reports where the simulation stopped.

Read the current date and the reported error before retrying. Do not expect another seven-day click to resume exactly the remainder of an interrupted seven-day request. A connection problem can also leave an operation's outcome uncertain; allow the interface to reconnect and inspect the resulting state instead of repeatedly submitting the same operation.

World preparation, career switching and other long operations display a busy state. A long wait is not permission to start overlapping changes from another tab.

## Persistence, snapshots and exports are different

The active career is stored in the database as you play. A **snapshot** is a restorable point in that career. A portable **`.touchline.gz` export** moves one world checkpoint between compatible installations; it is not your entire account, all snapshots or the host's disaster-recovery backup.

Use **Settings** to create, restore, export and import saves. Use the start screen's load view to browse saved careers. Careers are grouped by their persistent identity, so two careers with the same display name do not become one career.

### Retention rules

Normal per-career rotation keeps **10 manual snapshots** and **3 autosaves**. Imported checkpoints are excluded from normal rotation. Replacement dialogs identify snapshots that a new manual save would remove.

Autosave frequency is configurable:

| Setting | Trigger |
| --- | --- |
| Off | No automatic snapshots |
| Daily | After each simulated day |
| Weekly | At least seven game days since the previous autosave |
| Monthly | At least 28 game days since the previous autosave |

The monthly interval is 28 days, not necessarily the first day of a calendar month.

**Advice:** export an important long-term career outside the installation before a major experiment or host upgrade. A rotating autosave is convenient recovery, not a permanent archive.

## Loading and replacing

Starting a new career or loading another first preserves the current active career as a manual save. That preservation can itself rotate older manual snapshots; inspect the warning rather than assuming every earlier checkpoint is permanent.

Importing or restoring replaces the active world's state with the selected checkpoint. Check the career name, date and club before confirming. An export does not contain your identity-provider account or grant access on a different host.

Deletion is not ordinary switching. Deleting a saved career removes its grouped snapshots; deleting the active career requires typing the career's name, or the club name when the career has no name. Keep an export if you might want to return.

## Seasons and older worlds

At rollover, the game resolves league movement and histories, resets relevant seasonal records, refreshes budgets, processes aging cohorts and creates the next calendar. Promotion or relegation can change the finances and legal place of a reserve team as well as the first team.

An application update does not automatically regenerate your career. Older careers can have smaller worlds and already-drawn calendars. Historical planning notes describe an explicit world-expansion workflow, but the current player interface does not expose that control. Do not follow those notes as an in-game procedure, or start a new career expecting it to upgrade the old one.

Older checkpoints may lack data added by later releases. Compatibility backfills do not reconstruct every historical injury or event; an empty past-history panel is not proof that nothing ever happened.

For choosing the right advance interval throughout the year, see [season planning](strategy.md).
