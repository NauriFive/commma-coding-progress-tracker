export const IDLE_GAP_MS = 15 * 60 * 1000

export interface SessionGroup<T> {
  events: T[]
  closed: boolean
}

export function splitIntoSessions<T extends { ts: Date }>(
  rows: T[],
  now: number,
): SessionGroup<T>[] {
  if (rows.length === 0) return []

  const groups: T[][] = [[rows[0]]]
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].ts.getTime() - rows[i - 1].ts.getTime()
    if (gap > IDLE_GAP_MS) {
      groups.push([rows[i]])
    } else {
      groups[groups.length - 1].push(rows[i])
    }
  }

  return groups.map((group, index) => {
    const isLast = index === groups.length - 1
    const lastTs = group[group.length - 1].ts.getTime()
    return { events: group, closed: !isLast || now - lastTs >= IDLE_GAP_MS }
  })
}
