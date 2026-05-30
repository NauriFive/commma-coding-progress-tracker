import { eq, inArray } from 'drizzle-orm'
import {
  events,
  sessionFiles,
  sessionLangs,
  sessions,
  streaks,
} from '@commma/db'
import { db } from '../db.js'
import { log } from '../logger.js'
import { splitIntoSessions } from './boundaries.js'
import { buildSession } from './build.js'
import { addLeaderboardScore } from './leaderboard.js'
import { applyActiveDate, type StreakState } from './streak.js'
import type { EventRow } from './types.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function runAggregation(now = Date.now()): Promise<void> {
  const userRows = await db
    .selectDistinct({ userId: events.userId })
    .from(events)

  for (const { userId } of userRows) {
    try {
      await aggregateUser(userId, now)
    } catch (err) {
      log.error('aggregation_user_failed', {
        userId,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function aggregateUser(userId: string, now: number): Promise<void> {
  const userEvents = await db
    .select()
    .from(events)
    .where(eq(events.userId, userId))
    .orderBy(events.ts)

  const groups = splitIntoSessions(userEvents, now).filter((g) => g.closed)
  if (groups.length === 0) return

  const scored: { durationS: number; date: Date }[] = []

  await db.transaction(async (tx) => {
    let streakState = await loadStreak(tx, userId)

    for (const group of groups) {
      const draft = buildSession(group.events)

      const [session] = await tx
        .insert(sessions)
        .values({
          userId,
          startedAt: draft.startedAt,
          endedAt: draft.endedAt,
          durationS: draft.durationS,
          linesDelta: draft.linesDelta,
          paceCpm: draft.paceCpm,
          peakCpm: draft.peakCpm,
          peakAt: draft.peakAt,
          keyboardHeatmap: draft.keyboardHeatmap,
        })
        .returning({ id: sessions.id })

      if (draft.langs.length > 0) {
        await tx.insert(sessionLangs).values(
          draft.langs.map((l) => ({
            sessionId: session.id,
            lang: l.lang,
            durationS: l.durationS,
            pct: l.pct.toFixed(2),
          })),
        )
      }

      if (draft.files.length > 0) {
        await tx.insert(sessionFiles).values(
          draft.files.map((f) => ({
            sessionId: session.id,
            path: f.path,
            changes: f.changes,
          })),
        )
      }

      for (const date of draft.activeDates) {
        streakState = applyActiveDate(streakState, date)
      }

      await deleteEvents(tx, group.events)
      scored.push({ durationS: draft.durationS, date: draft.startedAt })
    }

    await saveStreak(tx, userId, streakState)
  })

  for (const entry of scored) {
    try {
      await addLeaderboardScore(userId, entry.durationS, entry.date)
    } catch (err) {
      log.error('leaderboard_update_failed', {
        userId,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function loadStreak(tx: Tx, userId: string): Promise<StreakState> {
  const [row] = await tx
    .select()
    .from(streaks)
    .where(eq(streaks.userId, userId))
    .limit(1)
  return {
    currentDays: row?.currentDays ?? 0,
    longestDays: row?.longestDays ?? 0,
    lastActiveDate: row?.lastActiveDate ?? null,
  }
}

async function saveStreak(
  tx: Tx,
  userId: string,
  state: StreakState,
): Promise<void> {
  await tx
    .insert(streaks)
    .values({
      userId,
      currentDays: state.currentDays,
      longestDays: state.longestDays,
      lastActiveDate: state.lastActiveDate,
    })
    .onConflictDoUpdate({
      target: streaks.userId,
      set: {
        currentDays: state.currentDays,
        longestDays: state.longestDays,
        lastActiveDate: state.lastActiveDate,
      },
    })
}

async function deleteEvents(tx: Tx, rows: EventRow[]): Promise<void> {
  await tx.delete(events).where(
    inArray(
      events.id,
      rows.map((r) => r.id),
    ),
  )
}
