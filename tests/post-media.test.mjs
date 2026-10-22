import test from "node:test";
import assert from "node:assert/strict";
import { isVideoAsset, isSafeMediaUrl } from "../src/postMedia.mjs";
test("treat Reels, video URLs and query strings as video not background images", () => {
  assert.equal(isVideoAsset("https://media.example.com/day01.mp4", "instagram_reel"), true);
  assert.equal(isVideoAsset("https://cdn.example.com/file.WEBM?token=abc"), true);
  assert.equal(isVideoAsset("https://cdn.example.com/asset", "instagram_reel"), true);
  assert.equal(isVideoAsset("https://cdn.example.com/day01.jpg", "linkedin"), false);
  assert.equal(isVideoAsset("https://cdn.example.com/story.jpg", "instagram_story"), false);
  assert.equal(isVideoAsset("https://cdn.example.com/story.jpg", "instagram_story"), false);
  assert.equal(isVideoAsset(null), false);
});
test("refuse invalid and unsafe media URLs", () => {
  assert.equal(isSafeMediaUrl("https://cdn.example.com/reel.mp4"), true);
  assert.equal(isSafeMediaUrl("javascript:alert(1)"), false);
  assert.equal(isSafeMediaUrl("file:///etc/passwd"), false);
  assert.equal(isSafeMediaUrl("invalid"), false);
});
