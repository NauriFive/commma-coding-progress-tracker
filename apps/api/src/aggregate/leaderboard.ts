import { redis } from '../redis.js'

const WEEK_TTL_S = 14 * 24 * 60 * 60
const MONTH_TTL_S = 40 * 24 * 60 * 60

export interface LeaderboardKeys {
  alltime: string
  week: string
  month: string
}

export function leaderboardKeys(date: Date): LeaderboardKeys {
  const month = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
  return {
    alltime: 'leaderboard:alltime',
    week: `leaderboard:week:${isoWeek(date)}`,
    month: `leaderboard:month:${month}`,
  }
}

export async function addLeaderboardScore(
  userId: string,
  durationS: number,
  date: Date,
): Promise<void> {
  const keys = leaderboardKeys(date)
  await redis
    .pipeline()
    .zincrby(keys.alltime, durationS, userId)
    .zincrby(keys.week, durationS, userId)
    .expire(keys.week, WEEK_TTL_S)
    .zincrby(keys.month, durationS, userId)
    .expire(keys.month, MONTH_TTL_S)
    .exec()
}

function isoWeek(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = d.getTime()
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const yearStartDay = (yearStart.getUTCDay() + 6) % 7
  yearStart.setUTCDate(yearStart.getUTCDate() - yearStartDay + 3)
  const week =
    1 +
    Math.round(
      (firstThursday - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000),
    )
  return `${d.getUTCFullYear()}-W${pad(week)}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
