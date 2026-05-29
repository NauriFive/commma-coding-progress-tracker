import { z } from 'zod'

export const PRIVACY_MODES = ['full', 'summary', 'off'] as const

export const privacyModeSchema = z.enum(PRIVACY_MODES)

export type PrivacyMode = z.infer<typeof privacyModeSchema>
