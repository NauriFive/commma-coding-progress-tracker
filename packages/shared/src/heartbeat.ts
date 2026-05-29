import { z } from 'zod'
import { keyLabelSchema } from './keyLabels'

export const keyFreqSchema = z.record(
  keyLabelSchema,
  z.number().int().nonnegative(),
)

export type KeyFreq = z.infer<typeof keyFreqSchema>

export const heartbeatEventSchema = z.object({
  id: z.string().uuid(),
  ts: z.number().int().positive(),
  lang: z.string().optional(),
  file: z.string().optional(),
  project: z.string().optional(),
  keystrokes: z.number().int().nonnegative(),
  lines: z.number().int(),
  key_freq: keyFreqSchema.optional(),
})

export type HeartbeatEvent = z.infer<typeof heartbeatEventSchema>

export const heartbeatBatchSchema = z.object({
  events: z.array(heartbeatEventSchema).min(1).max(500),
})

export type HeartbeatBatch = z.infer<typeof heartbeatBatchSchema>

export const ingestResponseSchema = z.object({
  received: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative(),
})

export type IngestResponse = z.infer<typeof ingestResponseSchema>
