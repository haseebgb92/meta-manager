import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

export type LocalAccount = {
  id: string;
  name: string;
  facebookPageId: string | null;
  instagramAccountId: string | null;
  status: string;
};

export type LocalCalendarItem = {
  id: string;
  accountId: string;
  title: string;
  platform: "facebook" | "instagram" | "instagram_reel" | "instagram_story" | "both" | "linkedin";
  status: string;
  caption: string | null;
  hashtags: string[];
  mediaUrl: string | null;
  linkUrl: string | null;
  publishedPostId: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  lastError: string | null;
};

export type LocalCalendarItemInput = {
  id?: string | null;
  accountId: string;
  title: string;
  platform: "facebook" | "instagram" | "instagram_reel" | "instagram_story" | "both" | "linkedin";
  status?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
  mediaUrl?: string | null;
  linkUrl?: string | null;
  scheduledFor: string | null;
};

export type MetaConfigStatus = {
  appId: string | null;
  apiVersion: string;
  configured: boolean;
  secretConfigured: boolean;
  redirectUri: string;
};

export type MetaOAuthPlan = {
  authorizationUrl: string;
  state: string;
  redirectUri: string;
};

export type MetaOAuthResult = {
  message: string;
  accounts: Array<{
    name: string;
    facebookPageId: string;
    instagramAccountId: string | null;
    instagramUsername: string | null;
  }>;
};

export const isDesktop = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getAccounts(): Promise<LocalAccount[]> {
  if (!isDesktop()) return [];
  return invoke<LocalAccount[]>("list_accounts");
}

export async function createAccount(name: string): Promise<LocalAccount> {
  return invoke<LocalAccount>("add_account", { name });
}

export async function getCalendar(accountId?: string | null): Promise<LocalCalendarItem[]> {
  if (!isDesktop()) return [];
  return invoke<LocalCalendarItem[]>("list_calendar", { accountId: accountId ?? null });
}

export async function saveCalendarItem(input: LocalCalendarItemInput): Promise<LocalCalendarItem> {
  return invoke<LocalCalendarItem>("save_calendar_item", { input });
}

export async function getMetaConfigStatus(): Promise<MetaConfigStatus | null> {
  if (!isDesktop()) return null;
  return invoke<MetaConfigStatus>("get_meta_config_status");
}

export async function saveMetaConfig(appId: string, apiVersion?: string): Promise<MetaConfigStatus> {
  return invoke<MetaConfigStatus>("save_meta_config", {
    appId,
    apiVersion: apiVersion || null,
  });
}

export async function saveMetaAppSecret(secret: string): Promise<void> {
  return invoke<void>("save_meta_app_secret", { secret });
}

export async function startMetaLogin(mode: "facebook" | "instagram" | "all" = "all"): Promise<MetaOAuthPlan> {
  const plan = await invoke<MetaOAuthPlan>("prepare_meta_oauth", { mode });
  await openUrl(plan.authorizationUrl);
  return plan;
}

export function onMetaOAuthComplete(callback: (result: MetaOAuthResult) => void) {
  if (!isDesktop()) return Promise.resolve(() => {});
  return listen<MetaOAuthResult>("meta-oauth-complete", (event) => callback(event.payload));
}

export function onMetaOAuthError(callback: (message: string) => void) {
  if (!isDesktop()) return Promise.resolve(() => {});
  return listen<string>("meta-oauth-error", (event) => callback(event.payload));
}

export type LivePost = {
  id: string;
  platform: "facebook" | "instagram";
  caption: string;
  createdAt: string;
  mediaUrl: string | null;
  permalinkUrl: string | null;
  likes: number;
  comments: number;
};

export type LiveWorkspace = {
  accountId: string;
  name: string;
  facebookPageId: string | null;
  facebookFollowers: number;
  facebookPictureUrl: string | null;
  instagramAccountId: string | null;
  instagramUsername: string | null;
  instagramFollowers: number;
  instagramMediaCount: number;
  instagramPictureUrl: string | null;
  recentPosts: LivePost[];
  status: string;
  error: string | null;
};

export type LiveDashboard = {
  connectedPages: number;
  connectedInstagram: number;
  facebookFollowers: number;
  instagramFollowers: number;
  recentPosts: LivePost[];
  workspaces: LiveWorkspace[];
};

export async function getLiveDashboard(accountId?: string | null): Promise<LiveDashboard | null> {
  if (!isDesktop()) return null;
  return invoke<LiveDashboard>("get_live_dashboard", { accountId: accountId ?? null });
}

export type PublishResult = {
  calendarItemId: string;
  facebookPostId: string | null;
  instagramPostId: string | null;
  linkedinPostId: string | null;
  message: string;
};

export async function publishCalendarItem(itemId: string): Promise<PublishResult> {
  return invoke<PublishResult>("publish_calendar_item", { itemId });
}

export type InsightPoint = { date: string; value: number };
export type InsightSeries = {
  key: string;
  label: string;
  platform: string;
  total: number;
  points: InsightPoint[];
};
export type LiveInsights = { days: number; series: InsightSeries[] };

export async function getLiveInsights(accountId?: string | null, days = 28): Promise<LiveInsights | null> {
  if (!isDesktop()) return null;
  return invoke<LiveInsights>("get_live_insights", { accountId: accountId ?? null, days });
}

export type MediaHostStatus = {
  siteUrl: string;
  username: string;
  configured: boolean;
};

export type HostedMedia = {
  url: string;
  mediaId: number | null;
  verifiedPublic: boolean;
  note: string;
};

export async function getMediaHostStatus(): Promise<MediaHostStatus> {
  return invoke<MediaHostStatus>("get_media_host_status");
}

export async function configureMediaHost(siteUrl: string, username: string, applicationPassword: string): Promise<MediaHostStatus> {
  return invoke<MediaHostStatus>("configure_media_host", {
    siteUrl, username, applicationPassword: applicationPassword || null,
  });
}

export async function uploadHostedMedia(base64Data: string, filename: string): Promise<HostedMedia> {
  return invoke<HostedMedia>("upload_hosted_media", { base64Data, filename });
}

export type McpStatus = { online: boolean; endpoint: string; diagnostic?: string };
export async function getMcpStatus(): Promise<McpStatus | null> {
  if (!isDesktop()) return null;
  return invoke<McpStatus>("get_mcp_status");
}

export async function restartMcpService(): Promise<McpStatus> {
  if (!isDesktop()) throw new Error("Meta Manager desktop application is required");
  return invoke<McpStatus>("restart_mcp_service");
}

export type MetaRefreshResult = {
  message: string;
  accounts: Array<{
    name: string;
    facebookPageId: string;
    instagramAccountId: string | null;
    instagramUsername: string | null;
  }>;
};

export async function refreshMetaAccounts(): Promise<MetaRefreshResult> {
  return invoke<MetaRefreshResult>("refresh_meta_accounts");
}

export type MediaLibrary = {
  items: LivePost[];
  total: number;
  requestedLimit: number;
};

export async function getMediaLibrary(accountId?: string | null, limit = 80): Promise<MediaLibrary> {
  return invoke<MediaLibrary>("get_media_library", { accountId: accountId ?? null, limit });
}

export type PublicMetaResearch = {
  query: string;
  normalizedHashtag: string;
  sourceAccountName: string;
  topMedia: LivePost[];
  recentMedia: LivePost[];
  relatedHashtags: Array<[string, number]>;
  relatedKeywords: Array<[string, number]>;
  note: string;
};

export async function researchPublicMeta(query: string, accountId?: string | null): Promise<PublicMetaResearch> {
  return invoke<PublicMetaResearch>("research_public_meta", { query, accountId: accountId ?? null });
}

export type LinkedInAccount = {
  id: string;
  memberId: string;
  name: string;
  email: string | null;
  pictureUrl: string | null;
  status: string;
};

export type LinkedInStatus = {
  personalAppId: string;
  personalClientId: string;
  personalRedirectUri: string;
  personalSecretConfigured: boolean;
  accounts: LinkedInAccount[];
  companyAppId: string;
  companyClientId: string;
  companyPage: string;
  companyStatus: string;
};

export type LinkedInOAuthPlan = {
  authorizationUrl: string;
  state: string;
  redirectUri: string;
};

export type LinkedInOAuthResult = {
  message: string;
  account: LinkedInAccount;
};

export async function getLinkedInStatus(): Promise<LinkedInStatus | null> {
  if (!isDesktop()) return null;
  return invoke<LinkedInStatus>("get_linkedin_status");
}

export async function saveLinkedInPersonalSecret(secret: string): Promise<void> {
  return invoke<void>("save_linkedin_personal_secret", { secret });
}

export async function startLinkedInLogin(): Promise<LinkedInOAuthPlan> {
  const plan = await invoke<LinkedInOAuthPlan>("prepare_linkedin_oauth");
  await openUrl(plan.authorizationUrl);
  return plan;
}

export function onLinkedInOAuthComplete(callback: (result: LinkedInOAuthResult) => void) {
  if (!isDesktop()) return Promise.resolve(() => {});
  return listen<LinkedInOAuthResult>("linkedin-oauth-complete", (event) => callback(event.payload));
}

export function onLinkedInOAuthError(callback: (message: string) => void) {
  if (!isDesktop()) return Promise.resolve(() => {});
  return listen<string>("linkedin-oauth-error", (event) => callback(event.payload));
}

export async function cancelSocialOAuth(): Promise<void> {
  if (!isDesktop()) return;
  return invoke<void>("cancel_social_oauth");
}

export type InstagramStatus = {
  appId: string | null;
  secretConfigured: boolean;
  redirectUri: string;
};

export type InstagramOAuthPlan = {
  authorizationUrl: string;
  state: string;
  redirectUri: string;
};

export type InstagramOAuthResult = {
  message: string;
  accountId: string;
  instagramAccountId: string;
  username: string;
  name: string;
};

export async function getInstagramStatus(): Promise<InstagramStatus | null> {
  if (!isDesktop()) return null;
  return invoke<InstagramStatus>("get_instagram_status");
}

export async function saveInstagramConfig(appId: string, secret?: string | null): Promise<InstagramStatus> {
  return invoke<InstagramStatus>("save_instagram_config", { appId, secret: secret || null });
}

export async function startInstagramLogin(): Promise<InstagramOAuthPlan> {
  const plan = await invoke<InstagramOAuthPlan>("prepare_instagram_oauth");
  await openUrl(plan.authorizationUrl);
  return plan;
}

export function onInstagramOAuthComplete(callback: (result: InstagramOAuthResult) => void) {
  if (!isDesktop()) return Promise.resolve(() => {});
  return listen<InstagramOAuthResult>("instagram-oauth-complete", (event) => callback(event.payload));
}

export function onInstagramOAuthError(callback: (message: string) => void) {
  if (!isDesktop()) return Promise.resolve(() => {});
  return listen<string>("instagram-oauth-error", (event) => callback(event.payload));
}

export type StrategistConfig = {
  enabled: boolean;
  platforms: string[];
  weekdays: number[];
  timeLocal: string;
  timezone: string;
  bufferDays: number;
  mode: "draft" | "schedule";
  website: string;
  description: string;
  audience: string;
  tone: string;
  pillars: string;
  avoid: string;
};

export type StrategistProfile = { accountId: string; config: StrategistConfig };
export type StrategistSlot = {
  accountId: string;
  platform: string;
  localDate: string;
  calendarItemId: string;
};

export async function listStrategistProfiles(): Promise<StrategistProfile[]> {
  if (!isDesktop()) return [];
  return invoke<StrategistProfile[]>("list_strategist_profiles");
}
export async function listStrategistSlots(): Promise<StrategistSlot[]> {
  if (!isDesktop()) return [];
  return invoke<StrategistSlot[]>("list_strategist_slots");
}
export async function saveStrategistProfile(accountId: string, config: StrategistConfig): Promise<StrategistProfile> {
  if (!isDesktop()) throw new Error("Requires the Meta Manager desktop app");
  return invoke<StrategistProfile>("save_strategist_profile", { accountId, config });
}
