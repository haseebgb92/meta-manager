import { invoke } from "@tauri-apps/api/core";
import type { HostedMedia } from "./localApi";
export type CloudStatus = { signedIn: boolean; email: string };
export type CloudPost = {
  id:string; sourceId:string; accountId:string; provider:string; title:string;
  status:string; scheduledFor:string; attempts:number; lastError:string|null;
  caption:string; hashtags:string[]; mediaUrl:string|null; linkUrl:string|null;
  publishedRemoteId:string|null; publishedAt:string|null;
};
export const getCloudStatus=()=>invoke<CloudStatus>("get_cloud_status");
export const cloudConnectExisting=()=>invoke<CloudStatus>("cloud_connect_existing");
export const cloudSendCode=(email:string)=>invoke<void>("cloud_send_code",{email});
export const cloudVerifyCode=(email:string,code:string)=>invoke<CloudStatus>("cloud_verify_code",{email,code});
export const cloudConnectAccount=(accountId:string,provider:"facebook"|"instagram"|"linkedin")=>
 invoke<void>("cloud_connect_account",{accountId,provider});
export const cloudDisconnectAccount=(accountId:string,provider:"facebook"|"instagram"|"linkedin")=>
 invoke<void>("cloud_disconnect_account",{accountId,provider});
export const cloudScheduleItem=(itemId:string)=>invoke<void>("cloud_schedule_item",{itemId});
export const cloudListPosts=()=>invoke<CloudPost[]>("cloud_list_posts");
export const cloudUploadMedia=(base64Data:string)=>invoke<HostedMedia>("cloud_upload_media",{base64Data});
export const cloudLogout=()=>invoke<void>("cloud_logout");
