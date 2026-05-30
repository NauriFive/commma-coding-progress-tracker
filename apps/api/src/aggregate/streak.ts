export interface StreakState {
  currentDays: number
  longestDays: number
  lastActiveDate: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export function applyActiveDate(state: StreakState, date: string): StreakState {
  if (state.lastActiveDate && date <= state.lastActiveDate) return state

  const continued =
    state.lastActiveDate !== null && isNextDay(state.lastActiveDate, date)
  const currentDays = continued ? state.currentDays + 1 : 1

  return {
    currentDays,
    longestDays: Math.max(state.longestDays, currentDays),
    lastActiveDate: date,
  }
}

function isNextDay(prev: string, next: string): boolean {
  return (
    Date.parse(`${next}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`) === DAY_MS
  )
}
