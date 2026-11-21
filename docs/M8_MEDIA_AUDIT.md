# M8 — Media Lifecycle Audit (Listening, Speaking, Backups)

Read-only audit of how Linguas de Gato keeps (or does not keep) the learner's media. It was written to explain a reported problem: *"I imported audio and could work with it, but later I can't play the original audio again."*

No source, schema, route or dependency changes were made. The audit traces the code in `apps/client`, `packages/shared` and `apps/server` at commit `7e2f36e`. The behaviour was reproduced on a production build in a clean browser profile, using a generated 2 s WAV and the stubbed transcription endpoint.

> **Status (M8 implementation, branch `feat/media-persistence`):**
>
> - **Implemented:** P1–P6, part of P7, and the backup checks in §10. See `ARCHITECTURE.md` D55–D58.
>   - P7: `persist()` is requested when a copy is made. The Settings status view is deferred.
>   - §10: kept media round-trips through backups, and omitted media restores as *needs the file*.
> - **Deferred:**
>   - P8: a content fingerprint for reconnecting.
>   - P9: a separate media export.
>   - P10: File System Access handles.
>
> **Implemented behaviour, in short:**
>
> - **Listening:** imported audio is kept by default for files ≤ 100 MB (opt-out at creation), and up to 500 MB on request. Keeping is refused when free space would drop below a 50 MB headroom.
> - **Speaking:** recordings are kept by default, up to 50 MB.
> - **Fallback:** if the media part of the write fails (a full disk), the session or attempt is saved without it and the page says *Storage limit reached*.
> - **Backups are unchanged:** media is embedded only within 50 MB per file and 100 MB in total. Otherwise it is left out, listed, and restored as *needs the file* or *no recording*.
>
> **Known M8 limitations:**
>
> - Storage-full and tight-quota cases were verified with simulated browser failures, not a really full disk.
> - The browser may still clear site data. `persist()` is requested, but its status isn't shown in Settings yet.
> - Media libraries over the backup limit must be exported without media.
> - Reconnection matches by file name and size only.
> - Sessions created before M8 without a copy still need their file once.
>
> The sections below describe the code *before* M8 and are kept as historical context.

---

## 1. Diagnosis

**The transcript is persisted; the audio is not.**

Every listening session made from a local file saves its metadata, transcript, dictation history, loop and position to IndexedDB. The **media file itself** is kept only in a JavaScript `Map` in page memory (`session-media-cache.ts`), unless the learner later ticks *"Keep a copy in this browser"*.

Any full page load drops that `Map`. A reload, closing the tab, reopening the app tomorrow, or pressing *Reload* on the M7.3 update banner all do this. From then on the session opens with *"Reconnect the recording"* instead of a player.

Classification:

| Finding | Type |
| --- | --- |
| Media not persisted by default (opt-in copy) | **Expected by design** (M1 decision: don't duplicate large files, respect quota) |
| The opt-in is offered only *after* creation, in the session sidebar, below the fold (y ≈ 1,336 px at 1440×900, ≈ 1,829 px of 2,162 px at 375 px), and only while the file is still in memory | **Discoverability problem: the main cause of the report** |
| Nothing in the session library, the Continue card or Today says a session has no playable media. *Continue dictation* lands on the reconnect card. | **Discoverability problem** |
| The creation panel never mentions that the audio will be forgotten | **Discoverability problem** |
| Speaking recordings follow the same pattern, but a lost recording **can never be reconnected** (the learner's own voice exists nowhere else) | **Design risk with irreversible data loss** |
| `mediaStored: true` with the blob missing shows *"A copy is kept"* next to a reconnect card, and reconnecting does not re-save the copy | **Latent implementation bug** (rare) |
| The update banner's *Reload* is not held back by unsaved in-memory media | **Implementation gap** (M7.3) |
| Three unrelated size limits (25 MB transcription, 500 MB stored copy, 50 MB/100 MB backup) | **Edge-case risk** |

No bug prevents playback when a copy was kept. The opt-in path works end to end: reconnect → tick → reload → the player is restored, as reproduced.

---

## 2. Data lifecycle

### 2.1 Local file → session (Transcribe, File tabs)

```
 Learner picks a file (New session panel)
        │  MediaDropzone → File + AcceptedMediaFile
        ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Transcribe tab: TranscribeNewSession                        │
 │   useTranscriptionJob.start(file) ──► POST /api/transcriptions
 │        (server: temp file → Groq Whisper → temp file deleted)
 │   createTranscribedSession(repo, file, accepted, result)    │
 │        └─ newFileSession(...)  source.mediaStored = false   │
 │        └─ repo.createSession(session, transcript)  ──► IDB  │
 │   rememberSessionMedia(id, file) ──► in-memory Map ONLY     │
 │ File tab: start(newFileSession(file), file) → same two calls│
 └─────────────────────────────────────────────────────────────┘
        ▼
 /listening/session/:id
   loadSession(): recallSessionMedia(id) → Blob (still in memory) → <audio src=blob:>
```

**Persisted in IndexedDB:**
- `sessions`: metadata, `source.{fileName,fileSize,lastModified,mimeType,mediaStored:false}`, playback position and rate, A-B loop, duration
- `transcripts`: cues, segments and words
- `dictation`
- `listeningExercises`

**Not persisted:** the `File` bytes.

### 2.2 Reopening a file session

```
 loadSession(repo, id)                         use-listening-session.ts
   media = recallSessionMedia(id)              ← Map, empty after any page load
   if (!media && source.mediaStored)           ← false by default
       media = repo.getMedia(id)               ← IDB "media" store
   return { session, cues, dictation, media }
        ▼
 LocalSessionView                              session-views.tsx
   objectUrl ? <MediaPlayer/> : <MediaReconnect/>
   sidebar: SessionTranscriptionCard ("Needs the file" when media is null)
            MediaCopyCard (checkbox disabled: "Reconnect the file first.")
```

### 2.3 Opting in to a copy (only possible after creation)

```
 MediaCopyCard.toggle(true)
   estimateStorage(): quota − usage ≥ fileSize + 50 MB headroom?
   requestPersistentStorage()      navigator.storage.persist(), best effort
   api.setMediaCopy(true, media)
      repo.saveMedia(id, blob)     one transaction: media.put + session.mediaStored = true
 next load: loadSession → repo.getMedia(id) → player restored
```

### 2.4 Reconnecting

```
 MediaReconnect.accept(file)
   name === source.fileName && size === source.fileSize ? attach : warn ("Use it anyway")
 api.attachMedia(file)  → rememberSessionMedia (memory only) + state
                         (no copy is written; the opt-in still has to be ticked)
```

### 2.5 YouTube

```
 YouTubeSourceForm → newYouTubeSession({videoId, startSeconds}) → IDB sessions
 YouTubeSessionView → useYouTubePlayer → official IFrame API on youtube-nocookie.com
 Subtitles: TranscriptPanel import (.srt/.vtt) → parseSubtitles → replaceTranscript → IDB transcripts
 No media bytes ever exist in the app, so there is nothing to persist or lose.
```

### 2.6 Speaking recordings

```
 useAudioRecorder → Blob (webm/opus or mp4)
 SpeakingPracticePage: after saving the attempt → rememberRecording(id, blob) → in-memory Map ONLY
 SpeakingAttemptPage → RecordingCard: "Keep this recording in this browser" (off by default)
      saveRecording(id, blob) → IDB speakingRecordings + attempt.recording.stored = true
 After any page load without the opt-in: "Not kept. Only the transcript and feedback were saved."
```

### 2.7 Backup

```
 createBackup(db, { includeMedia })                    backup-service.ts
   all data stores → JSON;  media + speakingRecordings → base64, only if
   total ≤ 100 MB and each item ≤ 50 MB (BACKUP_LIMITS), otherwise MediaTooLargeError
   excluded media is listed in envelope.media.omitted
 restore → mediaDecisions(...) + reconcileMediaFlags(...)
   a session or attempt whose blob isn't written gets mediaStored / recording.stored = false
```

---

## 3. Existing implementation (with references)

### 3.1 In-memory cache

`apps/client/src/features/listening/storage/session-media-cache.ts`:
- `const cache = new Map<string, Blob>()`, with `rememberSessionMedia`, `recallSessionMedia` and `forgetSessionMedia`.
- The header comment states the design: *"by default we only keep it in memory … a reload does [ask again] (unless the learner opted in to a saved copy)."*

### 3.2 Session creation

- `storage/listening-storage.ts` `newFileSession()` always sets `source.mediaStored: false`. File identity is kept as `fileName`, `fileSize`, `lastModified` and `mimeType`.
- `transcription/transcribed-session.ts` `createTranscribedSession()` writes the session and transcript in one transaction. Its comment: *"The media itself follows the M1 rule: it is not copied into the browser unless the learner opts in later."*
- `transcription/transcribe-new-session.tsx`, after transcribing: `createTranscribedSession(...)`, then `rememberSessionMedia(session.id, selection.file)`, then navigate.
- `listening-page.tsx` `NewSessionPanel.start()` (File tab): `createSession`, then `rememberSessionMedia`.

### 3.3 Loading and playback

- `session/use-listening-session.ts`:
  - `loadSession()` restores media from memory, or from IndexedDB only when `source.mediaStored`.
  - `attachMedia()` keeps the media in memory only.
  - `setMediaCopy()` calls `repository.saveMedia` or `deleteMedia`.
- `session/session-views.tsx` `LocalSessionView`: shows the player when there is an object URL, otherwise `MediaReconnect`. The sidebar holds `SessionTranscriptionCard` and `MediaCopyCard`.
- `session/practice-workspace.tsx`:
  - persists playback position and rate (`savePlayback`), the loop (`onLoopChange`) and the duration;
  - restores the position once the player is ready (`restorePosition`).
  - Without media, `state.ready` stays false, so *Play line*, replay and loop controls are disabled (`practice-bar.tsx`, `dictation/dictation-panel.tsx`). Typing dictation still works.

### 3.4 The copy

`session/media-copy-card.tsx`:
- `MAX_STORED_MEDIA_BYTES = 500 MB` and `QUOTA_HEADROOM_BYTES = 50 MB`.
- Disabled reasons:
  - no persistent storage;
  - file too large;
  - *"Reconnect the file first."* when `!mediaStored && !media`.
- Checks the quota with `estimateStorage()` and calls `requestPersistentStorage()` before writing.

`storage/indexed-db-listening-repository.ts`:
- `saveMedia` and `deleteMedia` go through `writeMediaFlag()`: the blob and the `mediaStored` flag change in one transaction.
- `getMedia` returns `row.blob` only if it is a `Blob`.
- `deleteSession()` removes the session, transcript, media, dictation and exercises together.

### 3.5 Reconnect verification

`session/media-reconnect.tsx` `accept()`:
- An exact `name` and `size` match attaches silently.
- Otherwise it warns, with *"Use it anyway"* or *"Choose another file"*.
- `lastModified` is stored but not used. No content hash.

### 3.6 Library and Continue (M7.3)

`session/session-library.tsx`:
- `sourceLine()` shows the format, size and line count, but **not** whether the media is available.
- `ContinueCard` links to `?mode=dictation` even when the session has no playable media.

### 3.7 Transcription card

`transcription/session-transcription-card.tsx` shows *"Needs the file — Reconnect the recording above to transcribe it."* when `media` is null.

### 3.8 YouTube

- **Embed:** `youtube/youtube-iframe-api.ts` uses the official IFrame API on `youtube-nocookie.com`; `youtube/use-youtube-player.ts` sets `enablejsapi: 1` and `origin`, and starts at the saved `positionSeconds` and `playbackRate`.
- **Transcription card:** `transcription-card.tsx` shows *"Not for YouTube"*: the app never accesses YouTube audio.
- **Subtitles:** `transcript-panel.tsx` imports subtitles (`SUBTITLE_ACCEPT_ATTRIBUTE`); `practice-workspace.tsx` parses them with `parseSubtitles()` and saves them with `replaceTranscript()` (dictation history for the session is reset).

### 3.9 Speaking

- `features/speaking/storage/speaking-storage.ts`: `const recordings = new Map<string, Blob>()`, with `rememberRecording`, `recallRecording` and `forgetRecording`.
- `speaking-practice-page.tsx` stores the blob in memory after saving the attempt.
- `speaking-attempt-page.tsx` `RecordingCard`:
  - The opt-in checkbox appears only while the recording is still in memory, or once it is stored.
  - Its quota check needs `recording.size * 2` free.
  - The loader restores from IndexedDB only when `recording.stored`.

### 3.10 Backup

- `packages/shared/src/contracts/backup.ts`:
  - `BACKUP_LIMITS.maxMediaTotalBytes = 100 MB` and `maxMediaItemBytes = 50 MB`;
  - `MEDIA_STORES` covers `media` and `speakingRecordings`;
  - `omittedMediaSchema`.
- `apps/client/src/features/data-management/backup-service.ts`:
  - `summarizeMedia()` and `createBackup()` throw `MediaTooLargeError` when the limits are exceeded;
  - `mediaDecisions()` decides what to write and remove;
  - the restore applies `reconcileMediaFlags()` from `packages/shared/src/learning/backup.ts`.
- `data-section.tsx` offers *Leave them out* or *Include*, and explains *"Export without media instead; your audio stays in this browser."*

### 3.11 Storage errors

`lib/storage/indexed-db.ts` `toStorageError()` maps `QuotaExceededError` to *"Browser storage is full. Delete old sessions or saved media copies to free space."*

### 3.12 Server

`apps/server` never stores media. The transcription upload is streamed to a temp file and deleted after the request (CLAUDE.md rule). **No server-side recovery is possible, by design.**

---

## 4. Reproduction

Verified on a production build, in a clean profile:

1. Listening → **New session** → Transcribe → choose `tone.wav` → **Transcribe**.
   - The session opens with an `<audio src="blob:…">` player and the transcript.
   - *"Keep a copy in this browser"* is unticked and sits in the sidebar, below the first screen. It was never shown in the creation panel.
2. Go back to Listening.
   - The library row shows "WAV · 62.5 KB · N lines" and nothing about missing audio.
3. Open the session again with a full page load (reload, new tab, next day, or the update banner's **Reload**).
   - **No player.** *"Reconnect the recording"* asks for `tone.wav (62.5 KB)`.
   - The transcription card says *"Needs the file"*.
   - The copy checkbox is disabled: *"Reconnect the file first."*
   - *Play line* and the loop are disabled; the transcript and dictation history are intact.
4. Choose the same file → the player returns, for this page lifetime only.
5. Tick *Keep a copy* → reload → **the player is restored** and the box stays ticked.

**Speaking.** Record → transcribe → save → reload the attempt page. The card shows *"Not kept. Only the transcript and feedback were saved."* The audio is unrecoverable.

---

## 5. Root causes

1. **Persistence is opt-in, and the opt-in comes after the moment of need.**
   - The only point where the bytes are available without asking is creation, and nothing is offered there.
   - After creation the choice lives below the fold and becomes impossible (disabled) after the first reload.
2. **State is invisible outside the session page.** The library, Continue card and Today don't distinguish *playable* from *needs the file*, so the learner discovers the loss only on opening.
3. **Transcript and media lifecycles are decoupled.** The transcript is written immediately and atomically; the media goes to a volatile `Map`. The UI copy (*"Transcripts and progress are always saved"*) is accurate but easy to read as "the session is saved".
4. **Reconnect is the only recovery, and it needs the original file.** Files are often in Downloads or temp folders, renamed or deleted, and a recording made in the app (Speaking) has no original at all.

---

## 6. Risks and edge cases

| # | Case | Current behaviour | Risk |
| --- | --- | --- | --- |
| E1 | `mediaStored: true` but the blob is missing (manual DevTools deletion, a partial restore from another tool, a future migration) | The player shows *Reconnect*, while `MediaCopyCard` says *"A … copy is kept"* with the box ticked. `attachMedia` does not re-save, so it stays broken across reloads until the learner unticks and re-ticks. | Low frequency, confusing. **Bug.** |
| E2 | Update banner *Reload* (M7.3) | `useHasWorkInProgress` covers AI requests, uploads and recordings, but not "file sessions whose media exists only in memory" | The learner loses access to the audio with one click. **Gap.** |
| E3 | File > 25 MB (default Groq limit) | It can't be transcribed, but can be opened with subtitles; a copy is allowed up to 500 MB | Fine, but a 60 MB copy then blocks backups that include media (E4) |
| E4 | Stored media item > 50 MB or total > 100 MB | `MediaTooLargeError`: the export must exclude media; the omitted items are listed in the envelope | Backups silently become audio-less for large libraries; restoring elsewhere means reconnecting everything |
| E5 | Browser eviction (best-effort storage, Safari's 7-day ITP rule for sites, low-disk eviction) | `persist()` is requested only when a copy is enabled; its result is ignored and not shown anywhere | The whole origin can be cleared, transcripts included. IndexedDB eviction is per-origin, so blobs and records go together. |
| E6 | Private window | The repository may fall back to memory (`fallbackReason`); the copy is disabled (*"Browser storage is unavailable"*) | Expected; already explained |
| E7 | Same file renamed, or re-encoded to the same size | Name and size are checked; `lastModified` is ignored and there is no hash | A different recording of identical size and name attaches silently (very unlikely); a renamed original triggers a mismatch warning (handled) |
| E8 | Video files | Same flow; copies can be large; `<video>` playback | Quota pressure |
| E9 | Speaking recording not kept | Permanent loss after a page load | **Irreversible.** Opus recordings are small (≈0.1–1 MB per minute), so the quota argument for opt-in is weak here. |
| E10 | Multiple tabs | The in-memory `Map` is per tab; a copy saved in one tab is visible to others on their next load | Minor |
| E11 | YouTube video removed or made private | The player shows an error with *Retry*; the transcript and progress survive | Expected; nothing local to recover |
| E12 | Subtitle timings vs a `startSeconds` link | Cue times are absolute video times and the player reports absolute times | Correct; offset subtitles (from another cut) would need a shift tool (not present) |

---

## 7. YouTube workflow: what works today

| Capability | Status | Notes |
| --- | --- | --- |
| Embedded playback | ✅ | Official IFrame API (`youtube-nocookie.com`), position and rate restored, keyboard shortcuts through the shared playback controls |
| Session persistence | ✅ | `videoId`, `startSeconds`, position, rate, loop, duration and title in IndexedDB; survives reloads, since there is no media to lose |
| SRT/WebVTT import | ✅ | Transcript panel import → `parseSubtitles` → `replaceTranscript`; skipped blocks are counted in the summary |
| Transcript sync | ✅ | Cues highlight with the YouTube player time; click a cue to seek |
| Dictation | ✅ | Line-by-line with the word-level diff; *Play line* uses bounded playback on the IFrame player |
| A-B loop and loop line | ✅ | Bounded playback works with the YouTube adapter; the loop persists in `session.loop` |
| Comprehension questions | ✅ | Generated from the imported transcript text (explicit action) |
| Automatic transcription | ❌ by design | The app never accesses YouTube streams (CLAUDE.md: official embed only, no extraction, downloaders, scraping or yt-dlp). The card says *"Not for YouTube … Import subtitles you are entitled to use instead."* |
| Fetching YouTube captions automatically | ❌ | Would need the YouTube Data API captions endpoint, which requires OAuth as the video owner for download, or unofficial endpoints (excluded). Not feasible within the rules. |

Practical YouTube workflow for the learner:
1. Create a YouTube session.
2. Get subtitles you are entitled to use (the creator's published subtitle file, or your own transcript), as `.srt` or `.vtt`.
3. Import them in the session.
4. Practise with dictation and loops.

To use automatic transcription, transcribe audio you own as a *file* session.

---

## 8. Proposed fixes (no code written; for M8 planning)

Ordered by value per effort.

### P1 — Offer the copy at creation, on by default under a size threshold *(discoverability, high value)*
- **Creation panel** (Transcribe and File tabs): a checkbox *"Keep the audio in this browser so it plays next time"*, **ticked by default when `file.size ≤ 100 MB` and the quota check passes**.
- **Write it with the session:** extend the creation write (`createSession` / `createTranscribedSession`) to also `put` the blob and set `mediaStored: true`. This can be the same transaction (`sessions`, `transcripts` and `media` are all in the v6 database) **without a schema change**: `media` already exists and `mediaStored` already exists on `FileSource`.
- **Fallback:** if the quota check fails, show the reason and create the session without the copy.

### P2 — Show media availability everywhere *(discoverability)*
- **Library row and Continue card:** a small status, *"Audio saved"* / *"Needs the file"*, from `source.mediaStored`, plus "in memory this visit" from `recallSessionMedia`.
- **Continue card:** for "needs the file" sessions, say *"Reconnect to continue"* instead of *Continue dictation*.
- **Session page:** move the copy control next to the player (or into the reconnect card: *"Choose the file — and keep it this time"*), not the bottom of the sidebar.

### P3 — Reconnect and keep in one step *(UX)*
In `MediaReconnect`, add *"Keep a copy after reconnecting"* (default on, same threshold). In `attachMedia`, also call `saveMedia` when chosen.

### P4 — Fix E1 *(bug)*
- **Self-heal on load:** in `loadSession`, if `source.mediaStored` but `getMedia()` returns null, clear the flag (`deleteMedia` already flips it) or return a `mediaMissing` state.
- **Honest UI:** `MediaCopyCard` should show *"The saved copy is missing; reconnect the file to restore it"*.
- **Re-save automatically** on reconnect when the flag was set.

### P5 — Make the update banner aware of volatile media *(gap)*
Register `useWorkInProgress(true)` in `LocalSessionView` while `data.media && !source.mediaStored` (with a clear message), or have the banner say *"Your open recording isn't saved; keep a copy first."*

### P6 — Speaking: keep recordings by default *(irreversible loss)*
Default the `RecordingCard` opt-in to **on** for new attempts (recordings are small), still with a quota check, and let the learner untick. Or at least warn before leaving the attempt page that the recording will be lost.

### P7 — Durable storage request and visibility
- **When to ask:** call `navigator.storage.persist()` on the first saved copy or recording, which already happens.
- **Show it:** add the result and the `estimate()` (used / free) to Settings → Data & backups, with *"Ask the browser to keep data"* if not persisted.

### P8 — Stronger reconnect matching *(edge)*
- **Match on `lastModified` too:** add it as a soft check.
- **Optional fingerprint:** a SHA-256 of the first 1 MB, computed with `crypto.subtle` and stored on the session (new optional field), for an exact match independent of name.

### P9 — Backups with large media *(backup)*
Keep JSON backups lightweight and add a **separate media export**: per-file downloads, or one archive, which would need a dependency to justify or a hand-written store-only zip. The JSON lists the omitted items (already in the envelope), and the import offers *"Attach media files"* that matches by `sessionId`, `fileName` and `size`. Alternatively, raise the item limit for streaming exports later.

### P10 — Optional, Chromium only: remember the file location
The File System Access API lets the app store a `FileSystemFileHandle` in IndexedDB. Reopening calls `handle.requestPermission({mode:'read'})`: one click, and no copy is needed. It is not available in Firefox or Safari, so it can only complement the copy (progressive enhancement). It would add a new IndexedDB value type, which needs a careful schema decision.

---

## 9. Recommended media storage strategy (personal, local-first)

1. **Copy small and medium media into the browser by default.** For one learner, a library of podcasts and lessons is usually tens to hundreds of MB, well within modern quotas (often several GB per origin on desktop Chromium/Firefox). IndexedDB blobs are fine at this scale, and the existing `media` store and flag already model it.
2. **Threshold and quota guard.**
   - Default on at ≤ 100 MB per file; above that, ask (cap stays 500 MB).
   - Always run the quota check with headroom (already implemented).
3. **Request persistent storage on the first saved media** and show its status. Explain plainly that browsers may still clear data, and that backups are the safety net.
4. **Keep transcripts and progress independent of media** (current design, good). Losing audio must never lose work.
5. **Recordings made in the app (Speaking) are originals.** Keep them by default.
6. **YouTube stays reference-only** (`videoId` + subtitles). Nothing to store; no extraction.
7. **Consider OPFS later for very large files.** The Origin Private File System offers streaming writes and reads without loading whole blobs into memory, and is supported by all modern engines. It is useful if 500 MB-plus videos become common. That would be a storage-layer change behind `ListeningRepository.getMedia/saveMedia`, not a UI change.

---

## 10. Backup implications

- **Current limits.**
  - JSON backups embed media as base64 (+33 %), only if the total is ≤ 100 MB and each item is ≤ 50 MB.
  - Otherwise the learner must export without media.
  - Omitted items are listed (`envelope.media.omitted`), and restore clears `mediaStored` / `recording.stored` for missing blobs (`reconcileMediaFlags`), so a restored profile is consistent: sessions open with *Reconnect*, and attempts show *Not kept*.
- **If P1/P6 make copies the default,** more learners will exceed 100 MB quickly. The backup flow should then:
  - say up front how much media exists and whether it fits (it already summarises this);
  - recommend the separate media export (P9) instead of silently omitting media;
  - keep replace-mode safety: local media whose records are in the backup is kept (`mediaDecisions` already does this).
- **Merge mode** never overwrites a local recording with an older copy (current rule). Keep it.
- **Restoring on another device** needs either the media export (P9) or reconnecting each file. Speaking recordings that weren't backed up are gone, which is another argument for P6 and P9.

---

## 11. Summary of what to change first

1. P1: keep a copy at creation by default (≤ 100 MB), in the same write as the session.
2. P2: media status in the library and Continue card, and the copy control next to the player.
3. P4: self-heal a missing copy.
4. P5: don't let *Reload* drop unsaved media silently.
5. P6: keep Speaking recordings by default.

None of these needs a database migration: the `media` / `speakingRecordings` stores and the `mediaStored` / `recording.stored` flags already exist in schema v6.
