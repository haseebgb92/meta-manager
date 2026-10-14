import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  FileText,
  Heart,
  Image,
  LayoutDashboard,
  Library,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Users,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";
import {
  getCloudStatus, cloudSendCode, cloudVerifyCode, cloudConnectExisting, cloudConnectAccount,
  cloudScheduleItem, cloudListPosts, cloudUploadMedia, cloudUploadVideo, cloudLogout, cloudDisconnectAccount,
  type CloudStatus, type CloudPost,
} from "./cloudApi";

import {
  createAccount,
  configureMediaHost,
  getMediaHostStatus,
  uploadHostedMedia,
  cancelSocialOAuth,
  getAccounts,
  getCalendar,
  getLiveDashboard,
  getLiveInsights,
  getMediaLibrary,
  getLinkedInStatus,
  getInstagramStatus,
  getMcpStatus,
  getMetaConfigStatus,
  onMetaOAuthComplete,
  onMetaOAuthError,
  onLinkedInOAuthComplete,
  onLinkedInOAuthError,
  onInstagramOAuthComplete,
  onInstagramOAuthError,
  publishCalendarItem,
  refreshMetaAccounts,
  researchPublicMeta,
  saveCalendarItem,
  saveMetaConfig,
  startMetaLogin,
  startLinkedInLogin,
  startInstagramLogin,
  type LiveDashboard,
  type LiveInsights,
  type LocalAccount,
  type LocalCalendarItem,
  type MetaConfigStatus,
  type McpStatus,
  type MediaLibrary,
  type MediaHostStatus,
  type LinkedInStatus,
  type InstagramStatus,
  type PublicMetaResearch,
} from "./localApi";

type Account = {
  name: string;
  platforms: string;
  initials: string;
  tone: string;
};


const nav = [
  ["Overview", LayoutDashboard],
  ["Research", Search],
  ["Content", FileText],
  ["Calendar", CalendarDays],
  ["Published", Send],
  ["Analytics", BarChart3],
  ["Media", Image],
  ["Accounts", Users],
  ["Settings", Settings],
] as const;



function Logo() {
  return (
    <div className="brand-mark" aria-label="Meta Manager logo">
      <div className="brand-orbit" />
      <div className="brand-panel">
        <span />
        <span />
        <span />
      </div>
      <i className="node node-one" />
      <i className="node node-two" />
      <i className="node node-three" />
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  change,
  accent,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  change: string;
  accent: string;
}) {
  return (
    <article className="card kpi-card">
      <div className={`metric-icon ${accent}`}><Icon size={20} /></div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small><b>↗ {change}</b> vs last 28 days</small>
      </div>
      <div className={`mini-line ${accent}`}>
        <svg viewBox="0 0 100 42" role="img">
          <path d="M2 34 C12 29, 19 12, 30 19 S47 30, 56 22 S71 8, 81 17 S92 15, 98 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      </div>
    </article>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "MM";
}

function accountTone(index: number) {
  return ["blue", "violet", "rose"][index % 3];
}

function App() {
  const [localAccounts, setLocalAccounts] = useState<LocalAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showConnectAccount, setShowConnectAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [showMetaSetup, setShowMetaSetup] = useState(false);
  const [metaConfig, setMetaConfig] = useState<MetaConfigStatus | null>(null);
  const [metaAppId, setMetaAppId] = useState("");
  const [metaApiVersion, setMetaApiVersion] = useState("v23.0");
  const [metaMessage, setMetaMessage] = useState("");
  const [connectingMeta, setConnectingMeta] = useState(false);
  const [connectingMetaProvider, setConnectingMetaProvider] = useState<"facebook" | "instagram" | null>(null);
  const [liveDashboard, setLiveDashboard] = useState<LiveDashboard | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [activeNav, setActiveNav] = useState("Overview");
  const [calendarItems, setCalendarItems] = useState<LocalCalendarItem[]>([]);
  const [showComposer, setShowComposer] = useState(false);
  const [composerTitle, setComposerTitle] = useState("");
  const [composerCaption, setComposerCaption] = useState("");
  const [composerPlatform, setComposerPlatform] = useState<"facebook" | "instagram" | "instagram_reel" | "instagram_story" | "both" | "linkedin">("both");
  const [composerSchedule, setComposerSchedule] = useState("");
  const [composerHashtags, setComposerHashtags] = useState("");
  const [composerMediaUrl, setComposerMediaUrl] = useState("");
  const [composerLinkUrl, setComposerLinkUrl] = useState("");
  const [mediaHostStatus, setMediaHostStatus] = useState<MediaHostStatus | null>(null);
  const [mediaHostUrl, setMediaHostUrl] = useState("");
  const [mediaHostUser, setMediaHostUser] = useState("");
  const [mediaHostPassword, setMediaHostPassword] = useState("");
  const [mediaHostMessage, setMediaHostMessage] = useState("");
  const [savingMediaHost, setSavingMediaHost] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | null>(null);
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudCode, setCloudCode] = useState("");
  const [cloudMessage, setCloudMessage] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [showCloudEmailFallback, setShowCloudEmailFallback] = useState(false);
  const [cloudMode, setCloudMode] = useState(true);
  const [cloudPosts, setCloudPosts] = useState<CloudPost[]>([]);
  const [cloudCalendarError, setCloudCalendarError] = useState("");

  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [savingComposer, setSavingComposer] = useState(false);
  const [composerMessage, setComposerMessage] = useState("");
  const [researchQuery, setResearchQuery] = useState("");
  const [liveInsights, setLiveInsights] = useState<LiveInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [calendarView, setCalendarView] = useState<"month" | "week" | "list">("month");
  const [viewingCalendarItem, setViewingCalendarItem] = useState<LocalCalendarItem | null>(null);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);
  const [accountRefreshMessage, setAccountRefreshMessage] = useState("");
  const [accountDataRevision, setAccountDataRevision] = useState(0);
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibrary | null>(null);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [researchResult, setResearchResult] = useState<PublicMetaResearch | null>(null);
  const [loadingResearch, setLoadingResearch] = useState(false);
  const [researchError, setResearchError] = useState("");
  const dashboardLoadedKey = useRef<string | null>(null);
  const calendarLoadedKey = useRef<string | null>(null);
  const mediaLoadedKey = useRef<string | null>(null);
  const metaOAuthTimer = useRef<number | null>(null);
  const linkedInOAuthTimer = useRef<number | null>(null);
  const [linkedInStatus, setLinkedInStatus] = useState<LinkedInStatus | null>(null);
  const [linkedInMessage, setLinkedInMessage] = useState("");
  const [connectingLinkedIn, setConnectingLinkedIn] = useState(false);
  const [instagramStatus, setInstagramStatus] = useState<InstagramStatus | null>(null);
  const [instagramMessage, setInstagramMessage] = useState("");
  const [connectingInstagram, setConnectingInstagram] = useState(false);
  const instagramOAuthTimer = useRef<number | null>(null);

  useEffect(() => {
    getAccounts().then(setLocalAccounts).catch(() => setLocalAccounts([]));
    getMetaConfigStatus().then((config) => {
      setMetaConfig(config);
      if (config?.appId) setMetaAppId(config.appId);
      if (config?.apiVersion) setMetaApiVersion(config.apiVersion);
    }).catch(() => null);
    getLinkedInStatus().then(setLinkedInStatus).catch(() => null);
    getInstagramStatus().then(setInstagramStatus).catch(() => null);
    getCloudStatus().then((cloud) => {
      setCloudStatus(cloud); setCloudEmail(cloud.email);
      if (cloud.signedIn) cloudListPosts().then(setCloudPosts).catch(() => null);
    }).catch(() => null);
    getMediaHostStatus().then((host) => {
      setMediaHostStatus(host);
      setMediaHostUrl(host.siteUrl);
      setMediaHostUser(host.username);
    }).catch(() => null);

    let unlistenComplete: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let unlistenLinkedInComplete: (() => void) | undefined;
    let unlistenLinkedInError: (() => void) | undefined;
    let unlistenInstagramComplete: (() => void) | undefined;
    let unlistenInstagramError: (() => void) | undefined;

    onMetaOAuthComplete(async (result) => {
      setMetaMessage(result.message);
      if (metaOAuthTimer.current) window.clearTimeout(metaOAuthTimer.current);
      metaOAuthTimer.current = null;
      setConnectingMeta(false);
      setConnectingMetaProvider(null);
      const refreshed = await getAccounts();
      dashboardLoadedKey.current = null;
      mediaLoadedKey.current = null;
      setAccountDataRevision((revision) => revision + 1);
      setLocalAccounts(refreshed);
      const connected = await getMetaConfigStatus();
      setMetaConfig(connected);
      setShowConnectAccount(false);
    }).then((dispose) => { unlistenComplete = dispose; });

    onMetaOAuthError((message) => {
      setMetaMessage(message);
      if (metaOAuthTimer.current) window.clearTimeout(metaOAuthTimer.current);
      metaOAuthTimer.current = null;
      setConnectingMeta(false);
      setConnectingMetaProvider(null);
    }).then((dispose) => { unlistenError = dispose; });

    onLinkedInOAuthComplete(async (result) => {
      setLinkedInMessage(result.message);
      if (linkedInOAuthTimer.current) window.clearTimeout(linkedInOAuthTimer.current);
      if (instagramOAuthTimer.current) window.clearTimeout(instagramOAuthTimer.current);
      linkedInOAuthTimer.current = null;
      instagramOAuthTimer.current = null;
      setConnectingLinkedIn(false);
      setLinkedInStatus(await getLinkedInStatus());
      setLocalAccounts(await getAccounts());
      setAccountDataRevision((revision) => revision + 1);
      dashboardLoadedKey.current = null;
      calendarLoadedKey.current = null;
      setShowConnectAccount(false);
    }).then((dispose) => { unlistenLinkedInComplete = dispose; });
    onLinkedInOAuthError((message) => {
      setLinkedInMessage(message);
      if (linkedInOAuthTimer.current) window.clearTimeout(linkedInOAuthTimer.current);
      linkedInOAuthTimer.current = null;
      setConnectingLinkedIn(false);
    }).then((dispose) => { unlistenLinkedInError = dispose; });

    onInstagramOAuthComplete(async (result) => {
      setInstagramMessage(result.message);
      if (instagramOAuthTimer.current) window.clearTimeout(instagramOAuthTimer.current);
      instagramOAuthTimer.current = null;
      setConnectingInstagram(false);
      setInstagramStatus(await getInstagramStatus());
      setLocalAccounts(await getAccounts());
      setAccountDataRevision((revision) => revision + 1);
      dashboardLoadedKey.current = null;
      mediaLoadedKey.current = null;
      calendarLoadedKey.current = null;
      setShowConnectAccount(false);
    }).then((dispose) => { unlistenInstagramComplete = dispose; });
    onInstagramOAuthError((message) => {
      setInstagramMessage(message);
      if (instagramOAuthTimer.current) window.clearTimeout(instagramOAuthTimer.current);
      instagramOAuthTimer.current = null;
      setConnectingInstagram(false);
    }).then((dispose) => { unlistenInstagramError = dispose; });

    return () => {
      unlistenComplete?.();
      unlistenError?.();
      unlistenLinkedInComplete?.();
      unlistenLinkedInError?.();
      unlistenInstagramComplete?.();
      unlistenInstagramError?.();
    };
  }, []);

  const accounts = useMemo<Account[]>(() => {
    if (!localAccounts.length) return [];
    return localAccounts.map((account, index) => ({
      name: account.name,
      platforms: account.status === "linkedin_connected"
        ? "LinkedIn"
        : account.facebookPageId && account.instagramAccountId
          ? "Facebook + Instagram"
          : account.facebookPageId
            ? "Facebook"
            : account.instagramAccountId
              ? "Instagram"
              : "Not connected",
      initials: initials(account.name),
      tone: accountTone(index),
    }));
  }, [localAccounts]);

  const selectedName = selectedAccountId
    ? localAccounts.find((account) => account.id === selectedAccountId)?.name ?? "All Accounts"
    : "All Accounts";

  useEffect(() => {
    const needsLive = ["Overview", "Published", "Accounts", "Analytics"].includes(activeNav);
    if (!needsLive) return;
    const selectedLocal = selectedAccountId ? localAccounts.find((account) => account.id === selectedAccountId) : null;
    if (selectedLocal?.status === "linkedin_connected") {
      setLiveDashboard(null);
      setLiveError("");
      setLoadingLive(false);
      dashboardLoadedKey.current = selectedAccountId;
      return;
    }
    const key = selectedAccountId ?? "all";
    if (dashboardLoadedKey.current === key && liveDashboard) return;
    let cancelled = false;
    setLoadingLive(true);
    setLiveError("");
    getLiveDashboard(selectedAccountId)
      .then((data) => { if (!cancelled) { setLiveDashboard(data); dashboardLoadedKey.current = key; } })
      .catch((error) => { if (!cancelled) { setLiveDashboard(null); setLiveError(String(error)); } })
      .finally(() => { if (!cancelled) setLoadingLive(false); });
    return () => { cancelled = true; };
  }, [activeNav, selectedAccountId, localAccounts.length, accountDataRevision]);

  const formatNumber = (value: number | undefined) => {
    const number = value ?? 0;
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`;
    if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 100_000 ? 0 : 1)}K`;
    return number.toLocaleString();
  };

  const recentLivePosts = liveDashboard?.recentPosts.slice(0, 5) ?? [];

  useEffect(() => {
    if (!["Overview", "Calendar", "Content", "Published"].includes(activeNav)) return;
    let cancelled = false;
    const refreshCalendar = () => getCalendar(selectedAccountId)
      .then((items) => { if (!cancelled) { setCalendarItems(items); calendarLoadedKey.current = selectedAccountId ?? "all"; } })
      .catch(() => { if (!cancelled) setCalendarItems([]); });
    refreshCalendar();
    const timer = window.setInterval(refreshCalendar, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selectedAccountId, activeNav]);

  useEffect(() => {
    if (!cloudStatus?.signedIn) return;
    if (!["Overview", "Calendar", "Content", "Published", "Accounts"].includes(activeNav)) return;
    let cancelled = false;
    const refreshCloud = () => {
      void cloudListPosts().then((posts) => {
        if (!cancelled) {
          setCloudPosts(posts);
          setCloudCalendarError("");
        }
      }).catch((error) => {
        if (!cancelled) setCloudCalendarError("Cloud calendar could not sync: " + String(error));
      });
    };
    refreshCloud();
    const timer = window.setInterval(refreshCloud, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [cloudStatus?.signedIn, activeNav, selectedAccountId]);

  useEffect(() => {
    const refresh = () => getMcpStatus().then(setMcpStatus).catch(() => setMcpStatus(null));
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeNav !== "Analytics") return;
    const selectedLocal = selectedAccountId ? localAccounts.find((account) => account.id === selectedAccountId) : null;
    if (selectedLocal?.status === "linkedin_connected") {
      setLiveInsights(null);
      setLoadingInsights(false);
      return;
    }
    let cancelled = false;
    setLoadingInsights(true);
    getLiveInsights(selectedAccountId, 28)
      .then((data) => { if (!cancelled) setLiveInsights(data); })
      .catch(() => { if (!cancelled) setLiveInsights(null); })
      .finally(() => { if (!cancelled) setLoadingInsights(false); });
    return () => { cancelled = true; };
  }, [activeNav, selectedAccountId, accountDataRevision]);

  useEffect(() => {
    if (activeNav !== "Media") return;
    const selectedLocal = selectedAccountId ? localAccounts.find((account) => account.id === selectedAccountId) : null;
    if (selectedLocal?.status === "linkedin_connected") {
      setMediaLibrary(null);
      setMediaError("");
      setLoadingMedia(false);
      mediaLoadedKey.current = selectedAccountId;
      return;
    }
    const key = selectedAccountId ?? "all";
    if (mediaLoadedKey.current === key && mediaLibrary) return;
    let cancelled = false;
    setLoadingMedia(true);
    setMediaError("");
    getMediaLibrary(selectedAccountId, 96)
      .then((data) => { if (!cancelled) { setMediaLibrary(data); mediaLoadedKey.current = key; } })
      .catch((error) => { if (!cancelled) { setMediaLibrary(null); setMediaError(String(error)); } })
      .finally(() => { if (!cancelled) setLoadingMedia(false); });
    return () => { cancelled = true; };
  }, [activeNav, selectedAccountId, accountDataRevision]);

  async function handleResearch() {
    const query = researchQuery.trim();
    if (!query || loadingResearch) return;
    setLoadingResearch(true);
    setResearchError("");
    try {
      setResearchResult(await researchPublicMeta(query, selectedAccountId));
    } catch (error) {
      setResearchResult(null);
      setResearchError(String(error));
    } finally {
      setLoadingResearch(false);
    }
  }

  const selectedAccount = selectedAccountId
    ? localAccounts.find((account) => account.id === selectedAccountId) ?? null
    : null;

  // Cloud-scheduled posts live in Supabase, not SQLite. Always merge both
  // sources, using a cloud record in preference to its matching local draft.
  const allCalendarItems = useMemo<LocalCalendarItem[]>(() => {
    const remote = cloudPosts
      .filter((post) => !selectedAccountId || post.accountId === selectedAccountId)
      .map((post): LocalCalendarItem => ({
        id: post.id,
        accountId: post.accountId,
        title: post.title,
        platform: post.provider as LocalCalendarItem["platform"],
        status: post.status === "scheduled" ? "cloud_scheduled"
          : post.status === "publishing" ? "cloud_publishing"
          : post.status,
        caption: post.caption || null,
        hashtags: post.hashtags || [],
        mediaUrl: post.mediaUrl || null,
        linkUrl: post.linkUrl || null,
        publishedPostId: post.publishedRemoteId || null,
        scheduledFor: post.scheduledFor,
        publishedAt: post.publishedAt || null,
        lastError: post.lastError || null,
      }));
    const cloudSourceIds = new Set(
      cloudPosts.filter((post) => !selectedAccountId || post.accountId === selectedAccountId)
        .map((post) => post.sourceId)
    );
    const local = calendarItems.filter((item) => !cloudSourceIds.has(item.id));
    return [...remote, ...local].sort((a, b) =>
      (a.scheduledFor || "").localeCompare(b.scheduledFor || "")
    );
  }, [calendarItems, cloudPosts, selectedAccountId]);
  const calendarDisplayItems = allCalendarItems.filter((item) => item.status !== "cancelled");
  const queueCalendarItems = calendarDisplayItems.filter((item) => item.status !== "published");
  const locallyPublishedItems = allCalendarItems.filter((item) => item.status === "published");
  const localPublishedItems = locallyPublishedItems.filter((item) => !(liveDashboard?.recentPosts ?? []).some((post) => item.publishedPostId?.includes(post.id)));
  const scheduledCount = queueCalendarItems.filter((item) => ["scheduled","cloud_scheduled"].includes(item.status)).length;
  const draftCount = queueCalendarItems.filter((item) => item.status === "draft").length;
  const linkedinPublishedItems = localPublishedItems.filter((item) => item.platform === "linkedin");
  const selectedInstagramDirect = Boolean(
    selectedAccount?.instagramAccountId && !selectedAccount.facebookPageId
  );
  const selectedLinkedInAccount = selectedAccount?.status === "linkedin_connected"
    ? linkedInStatus?.accounts.find((account) => account.id === selectedAccount.id) ?? null
    : null;
  const publishedCount = (liveDashboard?.recentPosts.length ?? 0) + localPublishedItems.length;
  const mediaItems = mediaLibrary?.items ?? [];

  const insightTotal = (key: string) => liveInsights?.series.find((series) => series.key === key)?.total ?? 0;

  const monthCalendar = useMemo(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const mondayIndex = (first.getDay() + 6) % 7;
    const cells: Array<{ date: Date | null; items: LocalCalendarItem[] }> = [];
    for (let i = 0; i < mondayIndex; i++) cells.push({ date: null, items: [] });
    for (let day = 1; day <= last.getDate(); day++) {
      const date = new Date(now.getFullYear(), now.getMonth(), day);
      const key = date.toISOString().slice(0, 10);
      cells.push({ date, items: calendarDisplayItems.filter((item) => item.scheduledFor?.slice(0,10) === key) });
    }
    while (cells.length % 7) cells.push({ date: null, items: [] });
    return { label: now.toLocaleDateString(undefined, {month:"long",year:"numeric"}), cells };
  }, [calendarDisplayItems]);

  const weekCalendar = useMemo(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return Array.from({length:7}, (_,index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate()+index);
      const key = date.toISOString().slice(0,10);
      return { date, items: calendarDisplayItems.filter((item)=>item.scheduledFor?.slice(0,10)===key) };
    });
  }, [calendarDisplayItems]);

  async function handleRefreshAccounts() {
    if (refreshingAccounts) return;
    setRefreshingAccounts(true);
    setAccountRefreshMessage("");
    try {
      const result = await refreshMetaAccounts();
      dashboardLoadedKey.current = null;
      mediaLoadedKey.current = null;
      setAccountDataRevision((revision) => revision + 1);
      const refreshedAccounts = await getAccounts();
      setLocalAccounts(refreshedAccounts);
      const selectedLocal = selectedAccountId ? refreshedAccounts.find((account) => account.id === selectedAccountId) : null;
      if (selectedLocal?.status !== "linkedin_connected") {
        const live = await getLiveDashboard(selectedAccountId);
        setLiveDashboard(live);
      } else {
        setLiveDashboard(null);
      }
      setAccountRefreshMessage(result.message);
    } catch (error) {
      setAccountRefreshMessage(String(error));
    } finally {
      setRefreshingAccounts(false);
    }
  }

  function handleRefreshAccountData() {
    dashboardLoadedKey.current = null;
    mediaLoadedKey.current = null;
    setAccountDataRevision((revision) => revision + 1);
    setAccountRefreshMessage("Refreshing profile details and recent posts for the selected accounts.");
  }

  async function handlePublishNow(item: LocalCalendarItem) {
    if (publishingId) return;
    setPublishingId(item.id);
    try {
      await publishCalendarItem(item.id);
      const refreshed = await getCalendar(selectedAccountId);
      setCalendarItems(refreshed);
      if (item.platform !== "linkedin") {
        const live = await getLiveDashboard(selectedAccountId);
        setLiveDashboard(live);
      }
    } catch (error) {
      setComposerMessage(String(error));
      const refreshed = await getCalendar(selectedAccountId);
      setCalendarItems(refreshed);
    } finally {
      setPublishingId(null);
    }
  }

  async function handleConnectCloud() {
    setCloudBusy(true);
    setCloudMessage("");
    try {
      const connected = await cloudConnectExisting();
      setCloudStatus(connected);
      setCloudEmail(connected.email);
      setCloudCode("");
      setShowCloudEmailFallback(false);
      setCloudMessage("Cloud connected. Your linked social account is ready for scheduled posts.");
      void cloudListPosts().then(setCloudPosts).catch(() => null);
    } catch (error) {
      setCloudMessage(String(error));
    } finally {
      setCloudBusy(false);
    }
  }
  async function sendCloudCode() {
    setCloudBusy(true); setCloudMessage("");
    try {
      await cloudSendCode(cloudEmail.trim());
      setCloudMessage("Check email. Paste the sign-in link without opening it, or enter a 6-digit code if provided.");
    } catch (e) {setCloudMessage(String(e))}
    finally {setCloudBusy(false)}
  }
  async function verifyCloudCode() {
    setCloudBusy(true); setCloudMessage("");
    try {
      const cloud = await cloudVerifyCode(cloudEmail.trim(), cloudCode.trim());
      setCloudStatus(cloud); setCloudCode(""); setCloudMessage("Cloud sign-in complete.");
      cloudListPosts().then(setCloudPosts).catch(() => null);
    } catch (e) {setCloudMessage(String(e))}
    finally {setCloudBusy(false)}
  }
  async function enrollCloudAccount(accountId: string, provider: "facebook" | "instagram" | "linkedin") {
    setCloudBusy(true);setCloudMessage("");
    try {
      await cloudConnectAccount(accountId,provider);
      setCloudMessage("Cloud publishing enabled for "+provider+". Publishing credentials are encrypted server-side.");
    } catch(e){setCloudMessage(String(e))}
    finally {setCloudBusy(false)}
  }
  async function revokeCloudAccount(accountId:string,provider:"facebook"|"instagram"|"linkedin"){
    setCloudBusy(true);setCloudMessage("");
    try {await cloudDisconnectAccount(accountId,provider);setCloudMessage(provider+" cloud access revoked; pending jobs cancelled.");}
    catch(e){setCloudMessage(String(e))}
    finally{setCloudBusy(false)}
  }
  async function refreshCloudPosts() {
    setCloudBusy(true); setCloudMessage("");
    try {setCloudPosts(await cloudListPosts())}
    catch(e){setCloudMessage(String(e))}
    finally {setCloudBusy(false)}
  }
  async function signOutCloud() {
    setCloudBusy(true);
    try {await cloudLogout(); setCloudStatus(await getCloudStatus()); setCloudPosts([]); setCloudMessage("Signed out locally. Revoke cloud account connections separately if needed.")}
    catch(e){setCloudMessage(String(e))}
    finally {setCloudBusy(false)}
  }

  async function handleSaveMediaHost() {
    if (savingMediaHost) return;
    setSavingMediaHost(true);
    setMediaHostMessage("");
    try {
      const host = await configureMediaHost(mediaHostUrl, mediaHostUser, mediaHostPassword);
      setMediaHostStatus(host);
      setMediaHostPassword("");
      setMediaHostMessage("Media host saved. You can now select images in the composer.");
    } catch (error) {
      setMediaHostMessage(String(error));
    } finally {
      setSavingMediaHost(false);
    }
  }

  async function handleLocalImage(file?: File) {
    if (!file || uploadingMedia) return;
    if (file.size > 10 * 1024 * 1024) {
      setComposerMessage("Maximum image size is 10 MB.");
      return;
    }
    if (!mediaHostStatus?.configured && !cloudStatus?.signedIn) {
      setComposerMessage("Configure WordPress Media Hosting in Settings first.");
      return;
    }
    setUploadingMedia(true);
    setComposerMessage("");
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = document.createElement("img");
      img.src = objectUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Unable to read selected image"));
      });
      const scale = Math.min(1, 1440 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not prepare image");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const base64Data = canvas.toDataURL("image/jpeg", 0.87).split(",")[1];
      const uploaded = cloudStatus?.signedIn ? await cloudUploadMedia(base64Data) : await uploadHostedMedia(base64Data, file.name);
      setComposerMediaUrl(uploaded.url);
      setComposerMessage(uploaded.note);
    } catch (error) {
      setComposerMessage(String(error));
    } finally {
      URL.revokeObjectURL(objectUrl);
      setUploadingMedia(false);
    }
  }

  async function handleLocalVideo(file?:File){
    if(!file||uploadingMedia)return;
    if(!cloudStatus?.signedIn){setComposerMessage("Connect Cloud in Settings to upload MP4 videos.");return;}
    if(file.type!=="video/mp4"||file.size>100*1024*1024){setComposerMessage("Choose an MP4 video under 100 MB.");return;}
    setUploadingMedia(true);setComposerMessage("Uploading video to cloud media hosting…");
    try{
      const base64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]);r.onerror=()=>reject(new Error("Cannot read video"));r.readAsDataURL(file);});
      const uploaded=await cloudUploadVideo(base64);
      setComposerMediaUrl(uploaded.url);setComposerMessage(uploaded.note);
    }catch(e){setComposerMessage(String(e));}finally{setUploadingMedia(false);}
  }

  async function handleSaveComposer(status: "draft" | "scheduled") {
    const selectedMatches = selectedAccount && (composerPlatform === "linkedin"
      ? selectedAccount.status === "linkedin_connected"
      : selectedAccount.status === "connected") ? selectedAccount : null;
    if (selectedAccount && !selectedMatches) {
      setComposerMessage("Selected workspace is not connected to " + (composerPlatform === "linkedin" ? "LinkedIn" : "Facebook/Instagram") + ". Switch accounts before scheduling.");
      return;
    }
    const account = selectedMatches ?? (composerPlatform === "linkedin"
      ? localAccounts.find((item) => item.status === "linkedin_connected")
      : localAccounts.find((item) => item.status === "connected")) ?? null;
    if (!account) {
      setComposerMessage("Select a connected workspace first.");
      return;
    }
    if (!composerTitle.trim()) {
      setComposerMessage("Add a post title.");
      return;
    }
    if (status === "scheduled" && !composerSchedule) {
      setComposerMessage("Choose a date and time before scheduling.");
      return;
    }
    if (composerLinkUrl.trim() && !/^https?:\/\//i.test(composerLinkUrl.trim())) {
      setComposerMessage("Links must start with https:// or http://."); return;
    }
    if ((["instagram","instagram_reel","instagram_story","both"].includes(composerPlatform)) && !/^https:\/\//i.test(composerMediaUrl.trim())) {
      setComposerMessage("Instagram needs a publicly accessible HTTPS media URL. Host your Reel video or Story image/video online first."); return;
    }
    if (composerMediaUrl.trim() && !/^https:\/\//i.test(composerMediaUrl.trim())) {
      setComposerMessage("Media URL must use public HTTPS."); return;
    }
    if (status === "scheduled" && new Date(composerSchedule).getTime() <= Date.now()) {
      setComposerMessage("Schedule must be a future date and time."); return;
    }
    if (composerPlatform === "instagram_reel" && !/\.mp4(?:\?|$)/i.test(composerMediaUrl.trim())) {setComposerMessage("Reels require a public HTTPS .mp4 video URL.");return;}
    setSavingComposer(true);
    setComposerMessage("");
    try {
      const useCloud = status === "scheduled" && !!cloudStatus?.signedIn && cloudMode;
      const item = await saveCalendarItem({
        accountId: account.id,
        title: composerTitle.trim(),
        platform: composerPlatform,
        status: useCloud ? "draft" : status,
        caption: composerCaption.trim() || null,
        hashtags: composerHashtags.split(/[\s,]+/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean),
        scheduledFor: status === "scheduled" && composerSchedule ? new Date(composerSchedule).toISOString() : null,
        mediaUrl: composerMediaUrl.trim() || null,
        linkUrl: composerLinkUrl.trim() || null,
      });
      if (useCloud) {
        await cloudScheduleItem(item.id);
        setCalendarItems((current) => [...current.filter((existing) => existing.id !== item.id), {...item, status: "cloud_scheduled"}]);
        void cloudListPosts().then(setCloudPosts).catch(() => null);
      } else {
        setCalendarItems((current) => [...current.filter((existing) => existing.id !== item.id), item]);
      }
      setComposerMessage(status === "scheduled" ? (useCloud ? "Cloud post scheduled — your computer can be off." : "Post scheduled locally.") : "Draft saved locally.");
      setComposerTitle("");
      setComposerCaption("");
      setComposerSchedule("");
      setComposerHashtags("");
      setComposerMediaUrl("");
      setComposerLinkUrl("");
      setTimeout(() => setShowComposer(false), 500);
    } catch (error) {
      setComposerMessage(String(error));
    } finally {
      setSavingComposer(false);
    }
  }

  async function handleAddAccount() {
    const name = newAccountName.trim();
    if (!name || savingAccount) return;
    setSavingAccount(true);
    try {
      const account = await createAccount(name);
      setLocalAccounts((current) => [...current, account]);
      setSelectedAccountId(account.id);
      setNewAccountName("");
      setShowAddAccount(false);
    } finally {
      setSavingAccount(false);
    }
  }

  async function handleConnectLinkedIn() {
    try {
      if (connectingLinkedIn || connectingMeta) {
        await cancelSocialOAuth().catch(() => null);
        if (linkedInOAuthTimer.current) window.clearTimeout(linkedInOAuthTimer.current);
        if (metaOAuthTimer.current) window.clearTimeout(metaOAuthTimer.current);
        linkedInOAuthTimer.current = null;
        metaOAuthTimer.current = null;
        setConnectingMeta(false);
        setConnectingMetaProvider(null);
      }
      setConnectingLinkedIn(true);
      setLinkedInMessage("");
      await startLinkedInLogin();
      setLinkedInStatus(await getLinkedInStatus());
      setLinkedInMessage("LinkedIn login opened in your browser.");
      if (linkedInOAuthTimer.current) window.clearTimeout(linkedInOAuthTimer.current);
      linkedInOAuthTimer.current = window.setTimeout(async () => {
        await cancelSocialOAuth().catch(() => null);
        setConnectingLinkedIn(false);
        setLinkedInMessage("LinkedIn login was not completed. You can try again.");
      }, 600_000);
    } catch (error) {
      setConnectingLinkedIn(false);
      setLinkedInMessage(String(error));
    }
  }

  async function closeConnectAccount() {
    if (connectingMeta || connectingLinkedIn || connectingInstagram) {
      await cancelSocialOAuth().catch(() => null);
      if (metaOAuthTimer.current) window.clearTimeout(metaOAuthTimer.current);
      if (linkedInOAuthTimer.current) window.clearTimeout(linkedInOAuthTimer.current);
      metaOAuthTimer.current = null;
      linkedInOAuthTimer.current = null;
      setConnectingMeta(false);
      setConnectingMetaProvider(null);
      setConnectingLinkedIn(false);
      setConnectingInstagram(false);
      if (connectingMeta) setMetaMessage("Meta login cancelled. You can reconnect anytime.");
      if (connectingLinkedIn) setLinkedInMessage("LinkedIn login cancelled. You can reconnect anytime.");
      if (connectingInstagram) setInstagramMessage("Instagram login cancelled. You can reconnect anytime.");
    }
    setShowConnectAccount(false);
  }

  async function handleConnectMetaProvider(mode: "facebook" | "instagram") {
    try {
      setMetaMessage("");
      await handleStartMetaLogin(mode);
    } catch (error) {
      setMetaMessage(String(error));
    }
  }

  async function handleConnectLinkedInProvider() {
    try {
      setLinkedInMessage("");
      await handleConnectLinkedIn();
    } catch (error) {
      setLinkedInMessage(String(error));
    }
  }

  async function handleConnectInstagram() {
    try {
      if (connectingMeta || connectingLinkedIn || connectingInstagram) {
        await cancelSocialOAuth().catch(() => null);
        if (metaOAuthTimer.current) window.clearTimeout(metaOAuthTimer.current);
        if (linkedInOAuthTimer.current) window.clearTimeout(linkedInOAuthTimer.current);
        if (instagramOAuthTimer.current) window.clearTimeout(instagramOAuthTimer.current);
        metaOAuthTimer.current = null; linkedInOAuthTimer.current = null; instagramOAuthTimer.current = null;
        setConnectingMeta(false); setConnectingLinkedIn(false);
      }
      setConnectingInstagram(true);
      setInstagramMessage("");
      const plan = await startInstagramLogin();
      setInstagramMessage(`Instagram login opened in your browser. Callback: ${plan.redirectUri}`);
      instagramOAuthTimer.current = window.setTimeout(async () => {
        await cancelSocialOAuth().catch(() => null);
        setConnectingInstagram(false);
        setInstagramMessage("Instagram login was not completed. You can try again.");
      }, 600_000);
    } catch (error) {
      setConnectingInstagram(false);
      setInstagramMessage(String(error));
    }
  }

  async function handleSaveMetaConfig() {
    try {
      const config = await saveMetaConfig(metaAppId, metaApiVersion);
      setMetaConfig(config);
      setMetaMessage(config.secretConfigured ? "Meta App Secret stored ✓ Settings saved." : "Settings saved, but the App Secret is still unavailable.");
    } catch (error) {
      setMetaMessage(String(error));
    }
  }

  async function handleStartMetaLogin(mode: "facebook" | "instagram" | "all" = "all") {
    try {
      if (connectingMeta || connectingLinkedIn) {
        await cancelSocialOAuth().catch(() => null);
        if (metaOAuthTimer.current) window.clearTimeout(metaOAuthTimer.current);
        if (linkedInOAuthTimer.current) window.clearTimeout(linkedInOAuthTimer.current);
        metaOAuthTimer.current = null;
        linkedInOAuthTimer.current = null;
        setConnectingLinkedIn(false);
      }
      setConnectingMeta(true);
      setConnectingMetaProvider(mode === "facebook" || mode === "instagram" ? mode : null);
      const plan = await startMetaLogin(mode);
      setMetaMessage(`Login opened in your browser. Callback: ${plan.redirectUri}`);
      if (metaOAuthTimer.current) window.clearTimeout(metaOAuthTimer.current);
      metaOAuthTimer.current = window.setTimeout(async () => {
        await cancelSocialOAuth().catch(() => null);
        setConnectingMeta(false);
        setConnectingMetaProvider(null);
        setMetaMessage("Meta login was not completed. You can try again.");
      }, 600_000);
    } catch (error) {
      setConnectingMeta(false);
      setConnectingMetaProvider(null);
      setMetaMessage(String(error));
    }
  }

  return (
    <>
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <div><strong>Meta Manager</strong><span>Local Social OS</span></div>
        </div>

        <section className="accounts-box">
          <p className="section-label">ACCOUNTS</p>
          <button className="all-accounts" onClick={() => setSelectedAccountId(null)}><Library size={16}/><span>{selectedName}</span><ChevronDown size={15}/></button>
          <div className="account-list">
            {accounts.map((account, index) => {
              const local = localAccounts[index];
              const selected = Boolean(local && selectedAccountId === local.id);
              return (
                <button
                  key={account.name}
                  className={`account-row ${selected ? "selected-account" : ""}`}
                  onClick={() => local && setSelectedAccountId(local.id)}
                >
                  <span className={`account-avatar ${account.tone}`}>{account.initials}</span>
                  <span><b>{account.name}</b><small>{account.platforms}</small></span>
                </button>
              );
            })}
            <button className="account-row add" onClick={() => setShowConnectAccount(true)}><span className="account-avatar add"><Plus size={15}/></span><span><b>Connect Account</b><small>Facebook · Instagram · LinkedIn</small></span></button>
          </div>
        </section>

        <nav className="nav-list">
          {nav.map(([label, Icon]) => (
            <button className={activeNav === label ? "active" : ""} key={label} onClick={() => setActiveNav(label)}><Icon size={18}/><span>{label}</span></button>
          ))}
        </nav>

        <button className="sidebar-footer" onClick={() => setShowMetaSetup(true)}>
          <div className={metaConfig?.configured ? "health-dot" : "health-dot warning"} />
          <span><b>Local service online</b><small>{metaConfig?.configured ? "Meta app configured" : "Configure Meta connection"}</small></span>
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow"><Sparkles size={15}/> {selectedName.toUpperCase()}</span>
            <h1>Good morning, Haseeb.</h1>
            <p>Here’s what’s happening across your social accounts today.</p>
          </div>
          <div className="top-actions">
            <label className="searchbox"><Search size={17}/><input placeholder="Search content, accounts, or insights..." /></label>
            <button className="avatar-button"><CircleUserRound size={22}/></button>
          </div>
        </header>

        {activeNav === "Overview" && (
          <>
            <section className="kpi-grid live-kpis">
              {selectedLinkedInAccount ? <>
                <KpiCard icon={Users} label="LinkedIn Account" value="1" change="Connected" accent="blue"/>
                <KpiCard icon={CheckCircle2} label="Profile Status" value="Active" change="OAuth" accent="pink"/>
                <KpiCard icon={Send} label="LinkedIn Posts" value={String(linkedinPublishedItems.length)} change="Published here" accent="violet"/>
                <KpiCard icon={Activity} label="Token" value="Valid" change="Connected" accent="mint"/>
              </> : <>
                <KpiCard icon={Users} label="Facebook Followers" value={loadingLive ? "…" : formatNumber(liveDashboard?.facebookFollowers)} change="Live" accent="blue"/>
                <KpiCard icon={Heart} label="Instagram Followers" value={loadingLive ? "…" : formatNumber(liveDashboard?.instagramFollowers)} change="Live" accent="pink"/>
                <KpiCard icon={CheckCircle2} label="Connected Pages" value={loadingLive ? "…" : String(liveDashboard?.connectedPages ?? 0)} change="Healthy" accent="violet"/>
                <KpiCard icon={Send} label="Recent Content" value={loadingLive ? "…" : String(liveDashboard?.recentPosts.length ?? 0)} change="Synced" accent="mint"/>
              </>}
            </section>

            <section className="dashboard-grid">
              <article className="card performance-card live-workspace-card">
                <div className="card-head">
                  <div><h2>Live Workspace Snapshot</h2><p>{selectedLinkedInAccount ? "Connected LinkedIn member" : selectedAccountId ? "Current connected brand" : "Audience across all connected social workspaces"}</p></div>
                  <span className={`sync-badge ${loadingLive ? "loading" : ""}`}>{selectedLinkedInAccount ? "Connected" : loadingLive ? "Syncing…" : "Live"}</span>
                </div>
                {liveError ? <div className="live-error">{liveError}</div> : null}
                <div className="workspace-live-list">
                  {selectedLinkedInAccount ? <div className="workspace-live-row linkedin-live-row">
                    <div className="live-avatar-wrap">{selectedLinkedInAccount.pictureUrl ? <img src={selectedLinkedInAccount.pictureUrl} alt=""/> : <span>{initials(selectedLinkedInAccount.name)}</span>}</div>
                    <div className="workspace-live-name"><b>{selectedLinkedInAccount.name}</b><small>{selectedLinkedInAccount.email || "LinkedIn member"}</small></div>
                    <div className="live-stat"><span>Platform</span><b>LinkedIn</b></div>
                    <div className="live-stat"><span>Published</span><b>{linkedinPublishedItems.length}</b></div>
                    <div className="live-stat"><span>Access</span><b>Write</b></div>
                    <em className="ok">Connected</em>
                  </div> : (liveDashboard?.workspaces ?? []).map((workspace) => (
                    <div className="workspace-live-row" key={workspace.accountId}>
                      <div className="live-avatar-wrap">
                        {workspace.instagramPictureUrl || workspace.facebookPictureUrl ? <img src={workspace.instagramPictureUrl || workspace.facebookPictureUrl || ""} alt="" /> : <span>{initials(workspace.name)}</span>}
                      </div>
                      <div className="workspace-live-name"><b>{workspace.name}</b><small>{workspace.instagramUsername ? `@${workspace.instagramUsername}` : workspace.facebookPageId ? "Facebook Page" : "Workspace"}</small></div>
                      <div className="live-stat"><span>Facebook</span><b>{formatNumber(workspace.facebookFollowers)}</b></div>
                      <div className="live-stat"><span>Instagram</span><b>{formatNumber(workspace.instagramFollowers)}</b></div>
                      <div className="live-stat"><span>IG Posts</span><b>{formatNumber(workspace.instagramMediaCount)}</b></div>
                      <em className={workspace.status === "connected" ? "ok" : "warn"}>{workspace.status === "connected" ? "Synced" : "Check"}</em>
                    </div>
                  ))}
                </div>
              </article>

              <article className="card health-card">
                <div className="card-head compact"><div><h2>Account Health</h2></div></div>
                <div className="health-list">
                  <div><span className="health-icon fb">f</span><span><b>Connected Pages</b><small>{liveDashboard?.connectedPages ?? 0} available through Meta</small></span><em>Healthy</em><ChevronRight size={16}/></div>
                  <div><span className="health-icon ig">◎</span><span><b>Instagram Accounts</b><small>{liveDashboard?.connectedInstagram ?? 0} linked professional accounts</small></span><em>Healthy</em><ChevronRight size={16}/></div>
                  <div><span className="health-icon li">in</span><span><b>LinkedIn Accounts</b><small>{linkedInStatus?.accounts.length ?? 0} connected personal profiles</small></span><em>{linkedInStatus?.accounts.length ? "Healthy" : "Not connected"}</em><ChevronRight size={16}/></div>
                  <div><span className="health-icon"><CheckCircle2 size={17}/></span><span><b>Calendar Queue</b><small>{scheduledCount} scheduled · {draftCount} drafts</small></span><em>{cloudStatus?.signedIn ? "Cloud + Local" : "Local"}</em><ChevronRight size={16}/></div>
                  <div><span className="health-icon"><Activity size={17}/></span><span><b>Live Sync</b><small>{loadingLive ? "Refreshing Meta data…" : "Latest profile and content data loaded"}</small></span><em>{loadingLive ? "Syncing" : "Online"}</em><ChevronRight size={16}/></div>
                </div>
              </article>

              <article className="card calendar-card">
                <div className="card-head compact"><div><h2>Calendar Queue</h2><p>Local drafts and cloud-scheduled posts</p></div><button className="link-btn" onClick={() => setActiveNav("Calendar")}>Open calendar <ChevronRight size={15}/></button></div>
                <div className="queue-preview">
                  {queueCalendarItems.slice(0, 6).map((item) => <button key={item.id} className="queue-preview-row queue-preview-button" onClick={() => setViewingCalendarItem(item)}><span className={`queue-status ${item.status}`}>{item.status}</span><b>{item.title}</b><small>{item.scheduledFor ? new Date(item.scheduledFor).toLocaleString() : "Not scheduled"}</small></button>)}
                  {!queueCalendarItems.length ? <div className="empty-live">No drafts or scheduled posts yet.</div> : null}
                </div>
              </article>

              <div className="right-stack">
                <article className="card upcoming-card">
                  <div className="card-head compact"><div><h2>Recent Published Content</h2></div><button className="link-btn" onClick={() => setActiveNav("Published")}>View all <ChevronRight size={15}/></button></div>
                  <div className="post-list">
                    {recentLivePosts.map((post) => <div className="post-row live-post-row" key={`${post.platform}-${post.id}`}><div className="post-thumb live-thumb" style={post.mediaUrl ? { backgroundImage: `url(${post.mediaUrl})` } : undefined}>{!post.mediaUrl ? <Image size={17}/> : null}</div><span><b>{post.caption || `${post.platform} post`}</b><small>{post.createdAt ? new Date(post.createdAt).toLocaleDateString() : "Recently published"} · {post.likes} likes · {post.comments} comments</small></span><i className={post.platform === "instagram" ? "platform-pill ig" : "platform-pill fb"}>{post.platform === "instagram" ? "IG" : "FB"}</i></div>)}
                  </div>
                </article>
                <article className="card ai-card"><div className="card-head compact"><div><h2><WandSparkles size={18}/> Content Workflow</h2></div></div><div className="recommendation"><div className="ai-art"><Sparkles size={20}/></div><span><b>Create your next post</b><small>Draft or schedule content locally for the selected workspace.</small></span><button onClick={() => { setActiveNav("Content"); setShowComposer(true); }}>Create</button></div></article>
              </div>
            </section>
          </>
        )}

        {activeNav === "Published" && (
          <section className="page-panel">
            <div className="page-title-row"><div><span className="eyebrow">RECENT SOCIAL CONTENT</span><h2>Recent Published</h2><p>{selectedLinkedInAccount ? "LinkedIn posts published through Social Manager. LinkedIn does not grant historical personal-post reading with the current permission tier." : "Latest Facebook and Instagram posts from the selected workspace, plus LinkedIn posts published through this app."}</p></div><span className={`sync-badge ${loadingLive ? "loading" : ""}`}>{loadingLive && !selectedLinkedInAccount ? "Loading…" : `${publishedCount} recent`}</span></div>
            <div className="published-grid">
              {(liveDashboard?.recentPosts ?? []).map((post) => <article className="card published-card" key={`${post.platform}-${post.id}`}><div className="published-media" style={post.mediaUrl ? {backgroundImage:`url(${post.mediaUrl})`} : undefined}>{!post.mediaUrl ? <Image size={26}/> : null}</div><div className="published-copy"><div><i className={post.platform === "instagram" ? "platform-pill ig" : "platform-pill fb"}>{post.platform === "instagram" ? "IG" : "FB"}</i><small>{post.createdAt ? new Date(post.createdAt).toLocaleString() : ""}</small></div><p>{post.caption || "Published post"}</p><footer><span>♥ {post.likes}</span><span>● {post.comments}</span></footer></div></article>)}
              {localPublishedItems.map((item) => <article className={`card published-card ${item.platform === "linkedin" ? "linkedin-published-card" : ""}`} key={`local-${item.id}`}><div className={`published-media ${item.platform === "linkedin" ? "linkedin-media" : ""}`} style={item.mediaUrl ? {backgroundImage:`url(${item.mediaUrl})`} : undefined}>{item.platform === "linkedin" ? <span>in</span> : !item.mediaUrl ? <Image size={26}/> : null}</div><div className="published-copy"><div><i className={`platform-pill ${item.platform === "linkedin" ? "li" : item.platform === "instagram" ? "ig" : "fb"}`}>{item.platform === "linkedin" ? "LI" : item.platform === "instagram" ? "IG" : item.platform === "facebook" ? "FB" : "META"}</i><small>{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : "Published"}</small></div><p>{item.caption || item.title}</p><footer><span>Published via Social Manager</span></footer></div></article>)}
              {!publishedCount ? <div className="empty-live roomy">No published content is available for this selection yet.</div> : null}
            </div>
          </section>
        )}

        {activeNav === "Analytics" && (
          <section className="page-panel">
            <div className="page-title-row"><div><span className="eyebrow">LIVE SNAPSHOT</span><h2>Analytics</h2><p>{selectedLinkedInAccount ? "LinkedIn personal-profile analytics are not available with the current self-service permissions." : "Audience and recent-content engagement where network permissions allow; direct Instagram logins may have limited insight access."}</p></div></div>
            {selectedLinkedInAccount ? <div className="empty-live roomy">Your LinkedIn account is connected for identity and publishing. Historical personal posts and analytics require restricted LinkedIn read permissions that are not currently granted.</div> : null}
            {selectedInstagramDirect ? <div className="card account-insights-notice">Your Instagram profile and media are available under Overview, Published and Media. Instagram's API has not granted this account access to reach and interaction insights, so these metrics are not displayed as zeros.</div> : null}
            {!selectedLinkedInAccount && !selectedInstagramDirect ? <><div className="kpi-grid">
              <KpiCard icon={BarChart3} label="Facebook Views" value={loadingInsights ? "…" : formatNumber(insightTotal("facebook_views"))} change="28D" accent="blue"/>
              <KpiCard icon={Heart} label="Facebook Engagement" value={loadingInsights ? "…" : formatNumber(insightTotal("facebook_engagement"))} change="28D" accent="pink"/>
              <KpiCard icon={Users} label="Instagram Reach" value={loadingInsights ? "…" : formatNumber(insightTotal("instagram_reach"))} change="28D" accent="violet"/>
              <KpiCard icon={Activity} label="Instagram Interactions" value={loadingInsights ? "…" : formatNumber(insightTotal("instagram_interactions"))} change="28D" accent="mint"/>
            </div>
            <div className="insight-series-grid">{(liveInsights?.series ?? []).map((series)=><article className="card insight-series-card" key={series.key}><div><span>{series.label}</span><b>{formatNumber(series.total)}</b></div><div className="mini-bars">{series.points.slice(-14).map((point,index)=>{const max=Math.max(...series.points.map((p)=>p.value),1);return <i key={`${point.date}-${index}`} style={{height:`${Math.max(4,(point.value/max)*100)}%`}} title={`${point.date}: ${point.value}`}/>})}</div></article>)}{!loadingInsights && !(liveInsights?.series.length) ? <div className="empty-live">Meta returned no supported insight series for this selection yet.</div> : null}</div>
            <article className="card analytics-table"><div className="card-head"><div><h2>Workspace Breakdown</h2><p>Audience totals by connected brand</p></div></div><div className="analytics-rows">{(liveDashboard?.workspaces ?? []).map((workspace) => <div key={workspace.accountId}><b>{workspace.name}</b><span>Facebook <strong>{formatNumber(workspace.facebookFollowers)}</strong></span><span>Instagram <strong>{formatNumber(workspace.instagramFollowers)}</strong></span><span>IG Media <strong>{formatNumber(workspace.instagramMediaCount)}</strong></span></div>)}</div></article></> : null}
          </section>
        )}

        {activeNav === "Calendar" && (
          <section className="page-panel">
            <div className="page-title-row"><div><span className="eyebrow">LOCAL + CLOUD PUBLISHING</span><h2>Content Calendar</h2><p>Local drafts and cloud-scheduled posts appear together. Cloud posting works when your computer is off.</p></div><button className="primary-page-button" onClick={() => setShowComposer(true)}><Plus size={16}/> New post</button></div>
            {cloudCalendarError ? <p className="live-error">{cloudCalendarError}</p> : null}
            <div className="calendar-toolbar"><div className="period-tabs"><button className={calendarView === "month" ? "selected" : ""} onClick={() => setCalendarView("month")}>Month</button><button className={calendarView === "week" ? "selected" : ""} onClick={() => setCalendarView("week")}>Week</button><button className={calendarView === "list" ? "selected" : ""} onClick={() => setCalendarView("list")}>List</button></div><b>{calendarView === "month" ? monthCalendar.label : calendarView === "week" ? "This week" : `${calendarDisplayItems.length} posts`}</b></div>
            {calendarView === "month" && <div className="month-calendar card"><div className="month-head">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day)=><b key={day}>{day}</b>)}</div><div className="month-grid">{monthCalendar.cells.map((cell,index)=><div className={`month-cell ${cell.date ? "" : "empty"}`} key={index}>{cell.date ? <><span>{cell.date.getDate()}</span>{cell.items.slice(0,3).map((item)=><button key={item.id} className={`month-item ${item.status}`} title={item.title} onClick={() => setViewingCalendarItem(item)}><i>{item.platform === "instagram" ? "IG" : item.platform === "facebook" ? "FB" : item.platform === "linkedin" ? "LI" : "BOTH"}</i>{item.title}</button>)}</> : null}</div>)}</div></div>}
            {calendarView === "week" && <div className="week-calendar">{weekCalendar.map((day)=><article className="card week-day" key={day.date.toISOString()}><header><b>{day.date.toLocaleDateString(undefined,{weekday:"short"})}</b><span>{day.date.getDate()}</span></header>{day.items.map((item)=><button className="week-item week-item-button" key={item.id} onClick={() => setViewingCalendarItem(item)}><span className={`queue-status ${item.status}`}>{item.status}</span><b>{item.title}</b><small>{item.scheduledFor ? new Date(item.scheduledFor).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : "—"}</small></button>)}{!day.items.length ? <p>No posts</p> : null}</article>)}</div>}
            {calendarView === "list" && <div className="calendar-list-card card"><div className="calendar-list-head"><span>Status</span><span>Post</span><span>Platform</span><span>Schedule</span><span>Action</span></div>{calendarDisplayItems.map((item) => <div className="calendar-list-row" key={item.id}><span className={`queue-status ${item.status}`}>{item.status}</span><div><b>{item.title}</b><small>{item.caption || "No caption yet"}</small>{item.lastError ? <small className="cloud-post-error">{item.lastError}</small> : null}</div><i className="platform-text">{item.platform}</i><time>{item.scheduledFor ? new Date(item.scheduledFor).toLocaleString() : "—"}</time><div className="calendar-actions"><button className="view-action" onClick={() => setViewingCalendarItem(item)}>View</button>{["draft","scheduled","failed"].includes(item.status) ? <button disabled={publishingId === item.id} onClick={() => handlePublishNow(item)}>{publishingId === item.id ? "Publishing…" : "Publish now"}</button> : null}</div></div>)}{!calendarDisplayItems.length ? <div className="empty-live">No local or cloud posts are available for this account yet.</div> : null}</div>}
          </section>
        )}

        {activeNav === "Content" && (
          <section className="page-panel">
            <div className="page-title-row"><div><span className="eyebrow">CONTENT STUDIO</span><h2>Create Content</h2><p>Build Facebook, Instagram, LinkedIn, or combined Meta posts from one composer.</p></div><button className="primary-page-button" onClick={() => setShowComposer(true)}><Plus size={16}/> Compose post</button></div>
            <div className="content-studio-grid"><article className="card content-empty"><WandSparkles size={30}/><h3>Ready to create</h3><p>Select a workspace, open the composer, write the caption and save it as a draft or schedule it.</p><button onClick={() => setShowComposer(true)}>Open composer</button></article><article className="card content-stats"><h3>Queue</h3><div><span>Drafts</span><b>{draftCount}</b></div><div><span>Scheduled</span><b>{scheduledCount}</b></div><div><span>Live synced posts</span><b>{publishedCount}</b></div></article></div>
          </section>
        )}

        {activeNav === "Research" && (
          <section className="page-panel">
            <div className="page-title-row"><div><span className="eyebrow">META DISCOVERY</span><h2>Research</h2><p>Research public Instagram hashtag content, related hashtags and caption keywords — not your own posts.</p></div></div>
            <div className="research-search card"><Search size={16}/><input value={researchQuery} onChange={(event) => setResearchQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && handleResearch()} placeholder="Keyword or hashtag, e.g. webdevelopment or #shopify" /><button disabled={!researchQuery.trim() || loadingResearch} onClick={handleResearch}>{loadingResearch ? "Searching…" : "Search Meta"}</button></div>
            {loadingResearch && <div className="section-skeleton research-skeleton"><i/><i/><i/></div>}
            {researchError ? <div className="live-error">{researchError}</div> : null}
            {!loadingResearch && !researchResult && !researchError ? <div className="empty-live roomy">Search a keyword or hashtag to query public Instagram hashtag content.</div> : null}
            {researchResult && !loadingResearch ? <>
              <div className="research-grid">
                <article className="card keyword-card"><div className="card-head"><div><h2>Related Hashtags</h2><p>Seen across public top + recent media for #{researchResult.normalizedHashtag}</p></div></div><div className="keyword-cloud">{researchResult.relatedHashtags.map(([word,count]) => <button key={word} onClick={() => setResearchQuery(`#${word}`)}><span>#{word}</span><b>{count}</b></button>)}{!researchResult.relatedHashtags.length ? <span className="research-muted">No related hashtags returned.</span> : null}</div></article>
                <article className="card keyword-card"><div className="card-head"><div><h2>Related Keywords</h2><p>Meaningful caption words from the public result set</p></div></div><div className="keyword-cloud">{researchResult.relatedKeywords.map(([word,count]) => <button key={word} onClick={() => setResearchQuery(word)}><span>{word}</span><b>{count}</b></button>)}</div></article>
              </div>
              <article className="card top-content-card"><div className="card-head"><div><h2>Top Public Media</h2><p>Public Instagram results for #{researchResult.normalizedHashtag} · queried through {researchResult.sourceAccountName}</p></div><span className="sync-badge">{researchResult.topMedia.length} top</span></div><div className="top-content-list">{researchResult.topMedia.map((post,index)=><div key={`top-${post.id}`}><strong>#{index+1}</strong><i className="platform-pill ig">IG</i><span>{post.caption || "Public Instagram post"}</span><b>{formatNumber(post.likes+post.comments)} engagements</b></div>)}</div></article>
              <article className="card top-content-card"><div className="card-head"><div><h2>Recent Public Media</h2><p>Latest public media returned by Meta for this hashtag</p></div><span className="sync-badge">{researchResult.recentMedia.length} recent</span></div><div className="top-content-list">{researchResult.recentMedia.map((post,index)=><div key={`recent-${post.id}`}><strong>#{index+1}</strong><i className="platform-pill ig">IG</i><span>{post.caption || "Public Instagram post"}</span><b>{formatNumber(post.likes+post.comments)} engagements</b></div>)}</div></article>
              <p className="research-note">{researchResult.note}</p>
            </> : null}
          </section>
        )}

        {activeNav === "Media" && (
          <section className="page-panel">
            <div className="page-title-row"><div><span className="eyebrow">MEDIA LIBRARY</span><h2>Media</h2><p>{selectedLinkedInAccount ? "LinkedIn personal media history is unavailable with the current self-service permissions." : "Deeper paginated sync of Facebook and Instagram media from the selected workspace."}</p></div><span className={`sync-badge ${loadingMedia ? "loading" : ""}`}>{selectedLinkedInAccount ? "LinkedIn connected" : loadingMedia ? "Syncing…" : `${mediaItems.length} items`}</span></div>
            {selectedLinkedInAccount ? <div className="empty-live roomy">LinkedIn is connected for publishing. Media history cannot be synced until LinkedIn grants the corresponding restricted read access.</div> : null}
            {loadingMedia && !mediaItems.length ? <div className="media-grid">{Array.from({length:12}).map((_,index)=><article className="media-card card media-skeleton" key={index}><div/><footer><span/></footer></article>)}</div> : null}
            {mediaError ? <div className="live-error">{mediaError}</div> : null}
            {!loadingMedia && !mediaItems.length && !mediaError ? <div className="empty-live roomy">No media was returned for this selection.</div> : null}
            <div className="media-grid">{mediaItems.map((post)=><article className="media-card card" key={`${post.platform}-${post.id}`}><a href={post.permalinkUrl || undefined} target="_blank" rel="noreferrer"><div style={{backgroundImage:`url(${post.mediaUrl})`}}/></a><footer><i className={post.platform === "instagram" ? "platform-pill ig" : "platform-pill fb"}>{post.platform === "instagram" ? "IG" : "FB"}</i><span>{post.caption || "Media post"}</span><small>{post.createdAt ? new Date(post.createdAt).toLocaleDateString() : ""}</small></footer></article>)}</div>
          </section>
        )}

        {activeNav === "Accounts" && (
          <section className="page-panel">
            <div className="page-title-row"><div><span className="eyebrow">CONNECTED WORKSPACES</span><h2>Accounts</h2><p>Manage Facebook, Instagram and connected LinkedIn personal profiles in one place.</p>{accountRefreshMessage ? <small className="account-refresh-message">{accountRefreshMessage}</small> : null}</div><div className="account-page-actions"><button className="secondary-page-button" onClick={handleRefreshAccountData}>Refresh profile data</button><button className="secondary-page-button" disabled={refreshingAccounts} onClick={handleRefreshAccounts}>{refreshingAccounts ? "Refreshing…" : "Refresh from Meta"}</button><button className="primary-page-button" onClick={() => setShowConnectAccount(true)}><Plus size={16}/> Connect account</button></div></div>
            <div className="accounts-page-grid">{(liveDashboard?.workspaces ?? []).map((workspace)=><article className="card account-detail-card" key={workspace.accountId}><div className="account-detail-head"><div className="live-avatar-wrap">{workspace.instagramPictureUrl || workspace.facebookPictureUrl ? <img src={workspace.instagramPictureUrl || workspace.facebookPictureUrl || ""} alt=""/> : <span>{initials(workspace.name)}</span>}</div><div><h3>{workspace.name}</h3><p>{workspace.instagramUsername ? `@${workspace.instagramUsername}` : "Facebook Page"}</p></div><em>{workspace.status === "connected" ? "Connected" : workspace.status}</em></div><div className="account-detail-stats"><div><span>Facebook followers</span><b>{workspace.facebookPageId ? formatNumber(workspace.facebookFollowers) : "—"}</b></div><div><span>Instagram followers</span><b>{workspace.instagramAccountId ? formatNumber(workspace.instagramFollowers) : "—"}</b></div><div><span>IG media</span><b>{workspace.instagramAccountId ? formatNumber(workspace.instagramMediaCount) : "—"}</b></div></div>{workspace.error ? <p className="account-sync-error">{workspace.error}</p> : null}<div className="account-card-actions"><button className="secondary-page-button" onClick={() => { setSelectedAccountId(workspace.accountId);setActiveNav("Overview"); }}>View account activity</button><button className="secondary-page-button" onClick={() => { setSelectedAccountId(workspace.accountId);setActiveNav("Media"); }}>View media</button></div></article>)}{(linkedInStatus?.accounts ?? []).map((account)=><article className="card account-detail-card linkedin-account-card" key={`li-${account.id}`}><div className="account-detail-head"><div className="live-avatar-wrap linkedin-avatar-large">{account.pictureUrl ? <img src={account.pictureUrl} alt=""/> : <span>{initials(account.name)}</span>}</div><div><h3>{account.name}</h3><p>{account.email || "LinkedIn personal profile"}</p></div><em>Connected</em></div><div className="account-detail-stats"><div><span>Platform</span><b>LinkedIn</b></div><div><span>Publishing</span><b>Enabled</b></div><div><span>History sync</span><b>Restricted</b></div></div></article>)}</div>
          </section>
        )}

        {activeNav === "Settings" && (
          <section className="page-panel">
            <div className="page-title-row"><div><span className="eyebrow">LOCAL CONFIGURATION</span><h2>Settings</h2><p>Meta connection, local storage and publishing service status.</p></div></div>
            <div className="settings-grid"><article className="card settings-card"><h3>Meta / Facebook</h3><div><span>App ID</span><code>{metaConfig?.appId ?? "1079289208340048"}</code></div><div><span>Credential source</span><b>Managed securely by backend</b></div><div><span>Graph version</span><code>{metaConfig?.apiVersion ?? "v23.0"}</code></div><small className="settings-help">No App Secret setup is required on this computer. Install Meta Manager anywhere and connect accounts with OAuth.</small></article><article className="card settings-card linkedin-settings"><h3>Instagram Professional</h3><div><span>Connection type</span><b>Direct Instagram Login</b></div><div><span>Instagram App ID</span><code>{instagramStatus?.appId ?? "2228119617760136"}</code></div><div><span>Credential source</span><b>Managed securely by backend</b></div><div><span>OAuth callback</span><code>{instagramStatus?.redirectUri ?? "https://127.0.0.1:38937/oauth/instagram/callback"}</code></div><div className="linkedin-actions"><button className="linkedin-connect" onClick={handleConnectInstagram}>{connectingInstagram ? "Open Instagram login" : "Connect Instagram"}</button></div>{instagramMessage ? <p className="setup-message linkedin-message">{instagramMessage}</p> : null}<small className="settings-help">No Instagram App Secret is stored in the desktop installation.</small></article><article className="card settings-card linkedin-settings"><h3>LinkedIn</h3><div><span>Personal posting app</span><b>Advertpreneur Social Manager</b></div><div><span>Client ID</span><code>{linkedInStatus?.personalClientId ?? "77drthb7h6mp7m"}</code></div><div><span>Credential source</span><b>Managed securely by backend</b></div><div><span>OAuth callback</span><code>{linkedInStatus?.personalRedirectUri ?? "http://127.0.0.1:38937/oauth/linkedin/callback"}</code></div><div className="linkedin-actions"><button className="linkedin-connect" onClick={handleConnectLinkedIn}>{connectingLinkedIn ? "Restart connection" : "Connect personal account"}</button></div>{linkedInMessage ? <p className="setup-message linkedin-message">{linkedInMessage}</p> : null}<div className="linkedin-member-list">{(linkedInStatus?.accounts ?? []).map((account)=><div key={account.id}><span className="linkedin-avatar">{account.pictureUrl ? <img src={account.pictureUrl} alt=""/> : initials(account.name)}</span><span><b>{account.name}</b><small>{account.email || "LinkedIn member"}</small></span><em>Connected</em></div>)}{!(linkedInStatus?.accounts.length) ? <small>No personal LinkedIn accounts connected yet.</small> : null}</div><hr/><div><span>Company Page app</span><b>Advertpreneur Page Publishing</b></div><div><span>Company client ID</span><code>{linkedInStatus?.companyClientId ?? "77uxxsydc367ll"}</code></div><div><span>Associated Page</span><b>{linkedInStatus?.companyPage ?? "advertpreneur"}</b></div><div><span>Community Management</span><b className="status-pending">Awaiting approval</b></div><small className="settings-help">Company Page publishing stays feature-gated until LinkedIn approves Community Management API access.</small></article><article className="card settings-card cloud-settings">
              <h3>Cloud Publishing — Free</h3>
              <p>Schedule posts when your computer is off. Connect using an existing social account — no separate Supabase setup required.</p>
              {!cloudStatus?.signedIn ? <>
                <button className="primary-page-button" disabled={cloudBusy} onClick={()=>void handleConnectCloud()}>
                  {cloudBusy ? "Connecting…" : "Connect Cloud"}
                </button>
                <small className="settings-help">Uses your connected LinkedIn profile or Instagram login. The selected account is enabled for secure cloud publishing; other accounts stay local until you enable them.</small>
                <button className="cloud-email-link" onClick={()=>setShowCloudEmailFallback(!showCloudEmailFallback)}>
                  {showCloudEmailFallback ? "Hide email sign-in" : "Use email instead"}
                </button>
                {showCloudEmailFallback ? <div className="cloud-email-fallback">
                  <label><span>Email</span><input type="email" value={cloudEmail} onChange={(e)=>setCloudEmail(e.target.value)} placeholder="Email address" /></label>
                  <button className="secondary-page-button" disabled={cloudBusy || !cloudEmail.includes("@")} onClick={()=>void sendCloudCode()}>Send login email</button>
                  <label><span>One-time code or unused link</span><input value={cloudCode} onChange={(e)=>setCloudCode(e.target.value)} placeholder="Code or link" /></label>
                  <button className="secondary-page-button" disabled={cloudBusy || !cloudCode.trim()} onClick={()=>void verifyCloudCode()}>Verify email</button>
                </div> : null}
              </> : <>
                <div><span>Signed in</span><b>{cloudStatus.email}</b></div>
                <p>Enable each account explicitly. This stores an encrypted publishing token on the cloud backend so the scheduler works while the desktop is closed.</p>
                <div className="cloud-account-list">
                  {localAccounts.flatMap((acct)=>{
                    const platforms: ("facebook"|"instagram"|"linkedin")[] = acct.status==="linkedin_connected"
                      ? ["linkedin"] : [
                        ...(acct.facebookPageId?["facebook" as const]:[]),
                        ...(acct.instagramAccountId?["instagram" as const]:[])
                      ];
                    return platforms.map((provider)=><div key={acct.id+"-"+provider} className="cloud-account-actions"><button className="secondary-page-button" disabled={cloudBusy} onClick={()=>void enrollCloudAccount(acct.id,provider)}>Enable · {acct.name} · {provider}</button><button className="secondary-page-button" disabled={cloudBusy} onClick={()=>void revokeCloudAccount(acct.id,provider)}>Revoke</button></div>);
                  })}
                </div>
                <button className="secondary-page-button" disabled={cloudBusy} onClick={()=>void refreshCloudPosts()}>Refresh cloud queue</button>
                <div className="cloud-job-list">
                  {cloudPosts.slice(0,12).map((post)=><div key={post.id}><b>{post.title}</b><small>{post.provider} · {post.status} · {new Date(post.scheduledFor).toLocaleString()}</small>{post.lastError?<small>{post.lastError}</small>:null}{post.firstCommentStatus==="failed"?<small>First comment failed: {post.firstCommentError || "Check Instagram/Facebook permissions"}</small>:post.firstCommentStatus==="published"?<small>First comment published</small>:null}</div>)}
                  {!cloudPosts.length?<small>No cloud posts yet.</small>:null}
                </div>
                <button className="secondary-page-button" disabled={cloudBusy} onClick={()=>void signOutCloud()}>Sign out on this computer</button>
              </>}
              {cloudMessage?<p className="setup-message">{cloudMessage}</p>:null}
              <small className="settings-help">Uses our existing free backend. Images up to 10 MB, 200 pending posts per user, and no paid account required.</small>
            </article><article className="card settings-card">
              <h3>Media Hosting — WordPress</h3>
              <p>Automatically upload local images and generate an Instagram-compatible public URL.</p>
              <label><span>WordPress website</span><input value={mediaHostUrl} onChange={(e) => setMediaHostUrl(e.target.value)} placeholder="https://your-site.com" /></label>
              <label><span>Username</span><input value={mediaHostUser} onChange={(e) => setMediaHostUser(e.target.value)} autoComplete="off" placeholder="WordPress account username" /></label>
              <label><span>Application Password</span><input type="password" value={mediaHostPassword} onChange={(e) => setMediaHostPassword(e.target.value)} autoComplete="new-password" placeholder={mediaHostStatus?.configured ? "Leave empty to retain existing" : "WordPress application password"} /></label>
              <button className="primary-page-button" disabled={savingMediaHost} onClick={handleSaveMediaHost}>{savingMediaHost ? "Saving…" : "Save media host"}</button>
              {mediaHostStatus?.configured ? <small>Configured: {mediaHostStatus.siteUrl}</small> : null}
              {mediaHostMessage ? <p className="setup-message">{mediaHostMessage}</p> : null}
              <small className="settings-help">Create a dedicated Application Password in WordPress → Users → Profile. Credentials are stored on your own computer.</small>
            </article><article className="card settings-card">
              <h3>Connect ChatGPT — MCP</h3>
              <p>Use a separate, secure tunnel to connect ChatGPT to Meta Manager's local publishing, calendar and research tools.</p>
              <div><span>Local MCP service</span><b>{mcpStatus?.online ? "Online" : "Start Meta Manager"}</b></div>
              <div><span>Local endpoint (not a public URL)</span><code>{mcpStatus?.endpoint ?? "http://127.0.0.1:38939/mcp"}</code></div>
              <p><b>1.</b> Install the ChatGPT MCP Bridge companion on this PC.</p>
              <p><b>2.</b> In Bridge, enter your OpenAI Runtime API key and a <b>dedicated Meta Manager tunnel ID</b> (<code>tunnel_...</code>). Use a different ID from Local or Web MCP.</p>
              <p><b>3.</b> Save settings, choose <b>Start Meta</b>, then connect that tunnel in ChatGPT.</p>
              <button className="secondary-page-button" onClick={() => void openUrl("https://github.com/haseebgb92/ChatGPT-MCp/releases")}>Get ChatGPT MCP Bridge</button>
              <small className="settings-help">The tunnel ID is entered and stored by Bridge, not by Meta Manager. The Runtime API key never belongs in a public URL. Keep both apps running for local ChatGPT access; cloud-scheduled jobs continue separately.</small>
              <p className="settings-help"><b>Connection failing?</b> Meta Manager privately records categorized OAuth and MCP startup failures. In MCP Bridge, open <b>Support diagnostics → Generate report</b> to review a combined report, then optionally open a GitHub issue draft. No secrets or raw logs are automatically uploaded.</p>
            </article><article className="card settings-card"><h3>Local Services</h3><div><span>SQLite</span><b>Online</b></div><div><span>Scheduler</span><b>Every 30 seconds</b></div><div><span>Connected workspaces</span><b>{localAccounts.length}</b></div><div><span>Publishing queue</span><b>{scheduledCount} scheduled</b></div><div><span>MCP service</span><b>{mcpStatus?.online ? "Online" : "Offline"}</b></div><div><span>MCP endpoint</span><code>{mcpStatus?.endpoint ?? "http://127.0.0.1:38939/mcp"}</code></div><small className="settings-help">{mcpStatus?.diagnostic ?? "Checking MCP service..."}</small></article></div>
          </section>
        )}

      </section>
    </main>

      {showConnectAccount && (
        <div className="modal-backdrop" onMouseDown={closeConnectAccount}>
          <section className="connect-account-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="composer-head"><div><span className="eyebrow">SOCIAL CONNECTIONS</span><h2>Connect an account</h2><p>Add another social identity without removing your existing connections.</p></div><button onClick={closeConnectAccount}>×</button></div>
            <div className="connect-provider-grid">
              <button className="connect-provider meta-provider facebook-provider" onClick={() => handleConnectMetaProvider("facebook")} disabled={!metaConfig?.secretConfigured}>
                <span className="provider-icons single"><i className="brand-letter fb-letter">f</i></span>
                <span><b>Facebook</b><small>Sign in with another Facebook user and import the Pages that user authorizes.</small></span>
                <em>{connectingMetaProvider === "facebook" ? "Opening Facebook login…" : "Connect Facebook"}</em>
              </button>
              <button className="connect-provider meta-provider instagram-provider" onClick={handleConnectInstagram} >
                <span className="provider-icons single"><i className="brand-letter ig-letter">◎</i></span>
                <span><b>Instagram Professional</b><small>Direct Instagram login for a Business or Creator account. No Facebook Page connection is required.</small></span>
                <em>{connectingInstagram ? "Opening Instagram login…" : "Connect Instagram"}</em>
              </button>
              <button className="connect-provider linkedin-provider" onClick={async () => { if (connectingMeta || connectingLinkedIn) await cancelSocialOAuth().catch(() => null); setConnectingMeta(false); setConnectingLinkedIn(false); await handleConnectLinkedInProvider(); }} >
                <span className="provider-icons single"><i className="brand-letter li-letter">in</i></span>
                <span><b>LinkedIn personal profile</b><small>Sign in with another LinkedIn member. Existing LinkedIn profiles stay connected.</small></span>
                <em>{connectingLinkedIn ? "Restart connection" : "Connect"}</em>
              </button>
            </div>
            <p className="connect-note">Provider credentials are managed securely by Meta Manager. Just choose an account and complete its OAuth login.</p>
            {metaMessage && connectingMeta ? <p className="setup-message">{metaMessage}</p> : null}
            {connectingMeta ? <div className="oauth-waiting-row"><span>Waiting for {connectingMetaProvider === "instagram" ? "Instagram" : "Facebook"} authorization in your browser.</span><button onClick={async () => { await cancelSocialOAuth().catch(() => null); if (metaOAuthTimer.current) window.clearTimeout(metaOAuthTimer.current); metaOAuthTimer.current = null; setConnectingMeta(false); setConnectingMetaProvider(null); setMetaMessage("Login cancelled. You can start another connection."); }}>Cancel</button></div> : null}
            {connectingInstagram ? <><p className="setup-message">{instagramMessage || "Instagram login opened in your browser."}</p><div className="oauth-waiting-row"><span>Waiting for Instagram authorization in your browser.</span><button onClick={async () => { await cancelSocialOAuth().catch(() => null); if (instagramOAuthTimer.current) window.clearTimeout(instagramOAuthTimer.current); instagramOAuthTimer.current = null; setConnectingInstagram(false); setInstagramMessage("Login cancelled. You can start another Instagram connection."); }}>Cancel</button></div></> : null}
            {linkedInMessage && connectingLinkedIn ? <p className="setup-message">{linkedInMessage}</p> : null}
            <div className="connect-account-footer"><span>Need a placeholder without OAuth?</span><button onClick={() => { setShowConnectAccount(false); setShowAddAccount(true); }}>Create local workspace</button></div>
          </section>
        </div>
      )}

      {viewingCalendarItem && (
        <div className="modal-backdrop" onMouseDown={() => setViewingCalendarItem(null)}>
          <section className="composer-modal calendar-view-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="composer-head"><div><span className="eyebrow">POST DETAILS</span><h2>{viewingCalendarItem.title}</h2></div><button onClick={() => setViewingCalendarItem(null)}>×</button></div>
            <div className="calendar-view-meta"><span className={`queue-status ${viewingCalendarItem.status}`}>{viewingCalendarItem.status}</span><i className="platform-text">{viewingCalendarItem.platform}</i><time>{viewingCalendarItem.scheduledFor ? new Date(viewingCalendarItem.scheduledFor).toLocaleString() : "Not scheduled"}</time></div>
            <div className="calendar-view-copy">{viewingCalendarItem.caption || "No caption yet."}</div>
            {viewingCalendarItem.hashtags.length ? <div className="calendar-view-tags">{viewingCalendarItem.hashtags.map((tag) => <span key={tag}>#{tag.replace(/^#/, "")}</span>)}</div> : null}
            {viewingCalendarItem.linkUrl ? <p><a href={viewingCalendarItem.linkUrl} target="_blank" rel="noreferrer">{viewingCalendarItem.linkUrl}</a></p> : null}
            {viewingCalendarItem.mediaUrl ? <div className="calendar-view-media" style={{backgroundImage:`url(${viewingCalendarItem.mediaUrl})`}}/> : null}
            {viewingCalendarItem.lastError ? <div className="live-error">{viewingCalendarItem.lastError}</div> : null}
            <div className="composer-actions"><button className="secondary" onClick={() => setViewingCalendarItem(null)}>Close</button>{["draft","scheduled","failed"].includes(viewingCalendarItem.status) ? <button className="primary" disabled={publishingId === viewingCalendarItem.id} onClick={async () => { await handlePublishNow(viewingCalendarItem); setViewingCalendarItem(null); }}>{publishingId === viewingCalendarItem.id ? "Publishing…" : "Publish now"}</button> : null}</div>
          </section>
        </div>
      )}

      {showComposer && (
        <div className="modal-backdrop" onMouseDown={() => setShowComposer(false)}>
          <section className="composer-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="composer-head"><div><span className="eyebrow">CONTENT COMPOSER</span><h2>{selectedName === "All Accounts" ? "Create post" : `Create for ${selectedName}`}</h2></div><button onClick={() => setShowComposer(false)}>×</button></div>
            <div className="composer-grid">
              <label><span>Title</span><input value={composerTitle} onChange={(event) => setComposerTitle(event.target.value)} placeholder="Internal post title" /></label>
              <label><span>Platform</span><select value={composerPlatform} onChange={(event) => setComposerPlatform(event.target.value as "facebook" | "instagram" | "instagram_reel" | "instagram_story" | "both" | "linkedin")}><option value="both">Facebook + Instagram</option><option value="facebook">Facebook</option><option value="instagram">Instagram feed</option><option value="instagram_reel">Instagram Reel</option><option value="instagram_story">Instagram Story</option><option value="linkedin">LinkedIn personal profile</option></select></label>
              <label className="composer-full"><span>Caption</span><textarea value={composerCaption} onChange={(event) => setComposerCaption(event.target.value)} placeholder="Write the post caption…" rows={8}/></label>
              <label className="composer-full"><span>Hashtags</span><input value={composerHashtags} onChange={(event) => setComposerHashtags(event.target.value)} placeholder="#webdevelopment #shopify #ecommerce" /></label>
              <label className="composer-full"><span>Media URL <small>{["instagram","instagram_reel","instagram_story","both"].includes(composerPlatform) ? "Public HTTPS media required. Reels need an accessible video URL; Stories accept an image or video URL." : "Optional public HTTPS image"}</small></span><input value={composerMediaUrl} onChange={(event) => setComposerMediaUrl(event.target.value)} placeholder="https://your-site.com/media.mp4" /></label>
              {composerPlatform !== "instagram_reel" && <label className="composer-full"><span>Upload Local Image</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadingMedia} onChange={(event) => { void handleLocalImage(event.target.files?.[0]); event.target.value = ""; }} /><small>{uploadingMedia ? "Converting and uploading…" : cloudStatus?.signedIn ? "Uploads to Supabase free storage and automatically fills the public URL." : mediaHostStatus?.configured ? "Uploads to your WordPress media library." : "Connect Cloud or configure WordPress Media Hosting in Settings."}</small></label>}
              {["instagram_reel","instagram_story"].includes(composerPlatform) && <label className="composer-full"><span>Upload MP4 Video</span><input type="file" accept="video/mp4" disabled={uploadingMedia} onChange={e=>{void handleLocalVideo(e.target.files?.[0]);e.target.value="";}} /><small>Requires Cloud connection; MP4 up to 100 MB.</small></label>}
              {composerMediaUrl.startsWith("https://") && !/\.(mp4|mov)(?:\?|$)/i.test(composerMediaUrl) ? <div className="composer-full" style={{display:"flex",gap:12,alignItems:"center"}}><img src={composerMediaUrl} alt="Post image preview" style={{width:76,height:76,objectFit:"cover",borderRadius:12}} /><small>Hosted image</small></div> : null}
              <label className="composer-full"><span>Link URL <small>Added to caption and first comment on Instagram/Facebook/LinkedIn posts and Reels; not supported for Stories.</small></span><input value={composerLinkUrl} onChange={(event) => setComposerLinkUrl(event.target.value)} placeholder="https://advertpreneur.com/your-article" /></label>
              {cloudStatus?.signedIn ? <label className="composer-full cloud-schedule-option"><span><input type="checkbox" checked={cloudMode} onChange={(e)=>setCloudMode(e.target.checked)} /> Publish using free Cloud Scheduler (works with computer off)</span><small>Enable the selected social account under Settings → Cloud Publishing first.</small></label> : null}
              <label className="composer-full"><span>Schedule</span><input type="datetime-local" value={composerSchedule} onChange={(event) => setComposerSchedule(event.target.value)} /><small>{cloudStatus?.signedIn && cloudMode ? "Cloud worker checks posts each minute; no desktop required." : "Keep Meta Manager running for local scheduling. Reels and Stories can use Cloud when configured."}</small></label>
            </div>
            {composerMessage ? <p className="setup-message">{composerMessage}</p> : null}
            <div className="composer-actions"><button className="secondary" disabled={savingComposer} onClick={() => handleSaveComposer("draft")}>Save draft</button><button className="primary" disabled={savingComposer || uploadingMedia} onClick={() => handleSaveComposer("scheduled")}>{savingComposer ? "Saving…" : "Schedule post"}</button></div>
          </section>
        </div>
      )}

      {showMetaSetup && (
        <div className="modal-backdrop" onMouseDown={() => setShowMetaSetup(false)}>
          <section className="account-modal meta-setup-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-icon"><Settings size={20}/></div>
            <div>
              <span className="eyebrow">META CONNECTION</span>
              <h2>Connect the publishing API</h2>
              <p>Provider credentials are managed by the Meta Manager backend. This panel only controls the public App ID and Graph API version.</p>
            </div>
            <label className="modal-field">
              <span>Meta App ID</span>
              <input value={metaAppId} onChange={(event) => setMetaAppId(event.target.value)} placeholder="App ID from Meta for Developers" />
            </label>
            <label className="modal-field">
              <span>Graph API version</span>
              <input value={metaApiVersion} onChange={(event) => setMetaApiVersion(event.target.value)} placeholder="v23.0" />
            </label>
            <div className="redirect-box"><b>OAuth callback</b><code>{metaConfig?.redirectUri ?? "http://127.0.0.1:38937/oauth/meta/callback"}</code></div>
            {metaMessage && <p className="setup-message">{metaMessage}</p>}
            <div className="modal-actions split-actions">
              <button className="secondary" onClick={handleSaveMetaConfig}>Save settings</button>
              <button className="primary" onClick={() => handleStartMetaLogin("all")} disabled={!metaAppId.trim()}>
                {connectingMeta ? "Open Meta login" : "Connect account"}
              </button>
            </div>
          </section>
        </div>
      )}

      {showAddAccount && (
        <div className="modal-backdrop" onMouseDown={() => setShowAddAccount(false)}>
          <section className="account-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-icon"><Plus size={20}/></div>
            <div>
              <span className="eyebrow">NEW WORKSPACE</span>
              <h2>Create local workspace</h2>
              <p>This is only a manual placeholder. Use Connect Account for real Facebook, Instagram or LinkedIn authentication.</p>
            </div>
            <label className="modal-field">
              <span>Account / brand name</span>
              <input
                autoFocus
                value={newAccountName}
                onChange={(event) => setNewAccountName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleAddAccount()}
                placeholder="e.g. Advertpreneur"
              />
            </label>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowAddAccount(false)}>Cancel</button>
              <button className="primary" onClick={handleAddAccount} disabled={!newAccountName.trim() || savingAccount}>
                {savingAccount ? "Creating..." : "Create workspace"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default App;