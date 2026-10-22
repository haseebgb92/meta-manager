import { useState } from "react";
import { ExternalLink, Film, Image as ImageIcon, Play, ShieldAlert } from "lucide-react";
import { isSafeMediaUrl, isVideoAsset } from "./postMedia.mjs";

/** Preview media without decoding a video as an image or auto-downloading video bytes. */
export default function PostMediaPreview({ url, platform }: { url: string | null | undefined; platform?: string }) {
  const [play, setPlay] = useState(false);
  if (!url) return null;
  if (!isSafeMediaUrl(url)) {
    return <div className="calendar-view-media calendar-view-media-placeholder"><ShieldAlert size={20} /> Invalid media link</div>;
  }
  const isVideo = isVideoAsset(url, platform);
  if (!isVideo) {
    return <div className="calendar-view-media calendar-view-media-image">
      <img alt="Scheduled post image" src={url} loading="lazy" decoding="async" />
      <a href={url} target="_blank" rel="noreferrer noopener"><ExternalLink size={15} /> Open image</a>
    </div>;
  }
  return <div className="calendar-view-media calendar-view-media-video">
    {play ? <video controls playsInline preload="metadata" src={url} aria-label="Scheduled post video preview" /> :
      <div className="calendar-view-media-placeholder">
        <Film size={30} />
        <span>Hosted video · tap to preview</span>
        <button type="button" onClick={() => setPlay(true)}><Play size={16} /> Preview video</button>
      </div>}
    <a href={url} target="_blank" rel="noreferrer noopener"><ExternalLink size={15} /> Open video in browser</a>
  </div>;
}

export function PostMediaThumbnail({ url, platform, className }: { url?: string | null; platform?: string; className: string }) {
  if (!url || !isSafeMediaUrl(url)) return <div className={className}><ImageIcon size={21}/></div>;
  if (isVideoAsset(url, platform)) return <div className={`${className} media-video-placeholder`}><Film size={21} /> <span>Video</span></div>;
  return <div className={`${className} post-image-thumbnail`}><img alt="" src={url} loading="lazy" decoding="async" /></div>;
}
