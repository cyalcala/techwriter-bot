# YouTube Transcript Feature

**Date**: 2026-07-31  
**Status**: Implemented  
**Commit**: (pending first push)

## Overview

Users can paste a YouTube URL in the chat, and the system automatically fetches the video's transcript and injects it as context for the AI response. No API keys required.

## Architecture

```
User message with YouTube URL
        │
        ▼
  /api/chat endpoint
        │
  ┌─────┴─────┐
  │ hasYouTubeUrl() detects URL
  │ detectYouTubeUrls() extracts video IDs
  │ fetchTranscript() fetches captions
  └─────┬─────┘
        │
        ▼
  YouTube innertube API (no key needed)
        │
  ┌─────┴─────┐
  │ Parse caption XML
  │ Clean & merge segments
  │ Format as context block
  └─────┬─────┘
        │
        ▼
  Injected into PromptContext.youtubeContext
        │
        ▼
  buildSystemPrompt() adds as priority-2 layer
        │
        ▼
  AI responds with knowledge of video content
```

## Files

| File | Purpose |
|------|---------|
| `src/lib/youtube-transcript.ts` | Core module: URL parsing, video ID extraction, caption fetching, transcript formatting |
| `src/pages/api/youtube-transcript.ts` | Standalone API endpoint for direct transcript requests |
| `src/pages/api/chat.ts` | Modified to auto-detect YouTube URLs and inject transcript context |
| `src/lib/prompts.ts` | Added `youtubeContext` field to `PromptContext` interface |
| `src/components/ChatMessages.svelte` | Added YouTube badge indicator on user messages with YT links |
| `src/tests/youtube-transcript.test.ts` | Unit tests for URL parsing, detection, formatting |

## How It Works

### Caption Extraction (Primary Path)
1. Fetches the YouTube watch page HTML
2. Extracts `ytInitialPlayerResponse` JSON from the page
3. Reads `captions.playerCaptionsTracklistRenderer.captionTracks`
4. Picks the best track (manual captions preferred over auto-generated, English preferred)
5. Fetches the timed text XML from the track's `baseUrl`
6. Parses `<text start="..." dur="...">` elements
7. Cleans HTML entities, strips tags, merges into readable paragraphs

### Track Selection Priority
1. Manual captions in preferred language (default: English)
2. Any manual captions
3. Auto-generated captions in preferred language
4. Any auto-generated captions

### Supported URL Formats
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/live/VIDEO_ID`
- `https://m.youtube.com/watch?v=VIDEO_ID`
- `https://www.youtube.com/v/VIDEO_ID`
- URLs with extra parameters (playlists, timestamps, etc.)

### Rate Limits (API endpoint)
- 10 requests per minute per IP
- 200 requests per day per IP

### Error Handling
- `NO_CAPTIONS`: Video has no caption tracks available
- `VIDEO_UNAVAILABLE`: Video is private, deleted, or region-locked
- `FETCH_FAILED`: Network error or YouTube returned non-200
- `PARSE_ERROR`: Could not extract player data from page HTML

## Cost

**Zero.** No API keys, no external services, no paid tiers. The innertube captions API is YouTube's public endpoint used by their own player.

## Limitations

- Only fetches existing captions (auto-generated or manual). Videos with captions disabled will fail with `NO_CAPTIONS`.
- First video ID only — if a user pastes multiple YouTube URLs, only the first is transcribed to stay within token budget.
- Caption fetch adds ~1-2 seconds latency to the chat response.
- Very long videos (2+ hours) may produce large transcripts that get truncated by the token budget enforcer.

## Frontend Indicator

When a user message contains a YouTube URL, a small red badge appears below the message bubble: "Transcript auto-fetched". This is a client-side detection only — no extra API call.

## Future Enhancements

- Cloudflare Workers AI Whisper fallback for videos without captions
- Timestamp-linked responses (clickable timestamps that open the video at that point)
- Multi-video support (process all URLs, not just the first)
- Transcript caching in KV to avoid re-fetching the same video
