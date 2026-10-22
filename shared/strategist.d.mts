import type { LocalAccount, LocalCalendarItem, StrategistConfig, StrategistSlot } from "../src/localApi";
export const DEFAULT_STRATEGIST: StrategistConfig;
export function allowedPlatforms(account: LocalAccount): string[];
export function normalizeProfile(profile: Partial<StrategistConfig> | null | undefined, account: LocalAccount): StrategistConfig;
export function localDate(instant: string | number | Date, zone: string): string;
export function zonedScheduleIso(day: string, time: string, zone: string): string;
export type CoverageSlot = { accountId: string; accountName: string; platform: string; localDate: string; timeLocal: string; timezone: string; scheduledFor: string; itemId?: string; reason?: string };
export type StrategistCoverage = { accountId: string; accountName: string; enabled: boolean; timezone: string; mode: "draft" | "schedule"; platforms: string[]; gaps: CoverageSlot[]; pending: CoverageSlot[]; covered: CoverageSlot[]; blocked: CoverageSlot[] };
export function strategistCoverage(args: { profile: Partial<StrategistConfig>; account: LocalAccount; items?: LocalCalendarItem[]; reservations?: StrategistSlot[]; now?: Date }): StrategistCoverage;

export function prioritizeActiveAccounts<T extends { config: { enabled?: boolean } }>(items: T[]): T[];
