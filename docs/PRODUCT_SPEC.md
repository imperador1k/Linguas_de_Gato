# Product Specification — Linguas de Gato

## 1. Vision

Linguas de Gato is a personal, extensible language-learning workspace. It supports deliberate practice for an advanced learner rather than casual, gamified study. English is the first target language; the domain model keeps the target language explicit so other languages can be added later without a rewrite.

## 2. Learner profile

| Attribute | Value |
| --- | --- |
| Current level | B2 (CEFR) English |
| Goal | C1, then C2 |
| Motivation | Self-directed, deliberate practice |
| Usage | Desktop first (focused sessions), usable on tablet and phone |

What a B2 → C1 learner needs, and what the product therefore optimises for:

- **Authentic input at natural speed**, with tools to slow down, loop and inspect it (Listening, Reading).
- **Precise feedback on output**: not only "correct / incorrect" but *natural vs. unnatural*, register and collocation (Writing, Speaking).
- **Targeted grammar** at the B2–C1 boundary: inversion, cleft sentences, mixed conditionals, hedging, nominalisation, advanced modality.
- **Memory of recurring mistakes**, so practice is driven by evidence (Progress).

## 3. Non-goals and constraints

1. No authentication or user accounts. It is a single-user, local-first application.
2. No server-side database. Learner data lives in the browser (IndexedDB when needed).
3. No subscriptions or payments.
4. No microservices or container infrastructure.
5. No gamification: no XP, streaks, badges, confetti or leaderboards.
6. No unofficial YouTube stream extraction, downloading or scraping (see §6).

## 4. Modules

Each module has a status: **Available** (implemented), **In progress**, or **Planned**.

| Module | Purpose | Key capabilities | Status |
| --- | --- | --- | --- |
| Listening | Comprehension of authentic audio/video | Media import, custom audio controls, automatic transcription (Groq Whisper), subtitle import, synchronised transcript (files and YouTube), replay line, A-B loop, dictation with word-level feedback, AI comprehension exercises grounded in the transcript, saved sessions | Available |
| Speaking | Deliberate speaking practice with evidence-based feedback | B2/C1 prompt library, custom topics and AI-generated B2/C1/C2 tasks, free and guided modes, microphone recording, Whisper transcription with learner review, AI feedback on grammar, vocabulary, coherence, naturalness and task achievement (every correction quoted from the transcript), deterministic fluency measurements, follow-up exercises, saved attempts; pronunciation scoring planned | Available |
| Writing | Accuracy and naturalness in long-form output | AI-generated B2–C2 tasks in 12 formats, autosaved drafts, evidence-based feedback separating errors from suggestions, annotated corrections, optional improved version | Available |
| Grammar | Targeted B2–C2 structures | AI-generated sets in six question types on 12 areas, verified answer keys, deterministic scoring, rules and distractor explanations, retries and history | Available |
| Reading | Comprehension of authentic-feeling and personal texts | AI-generated B2–C2 texts and pasted texts, adjustable reading view, saved progress, contextual lookups, comprehension questions grounded in the text | Available |
| Vocabulary | Contextual lexis and collocations | Expressions saved with their sentence and contextual meaning, several meanings per expression, review schedule, practice with deterministic scoring and AI feedback on open answers | Available |
| Progress | Evidence-based self-assessment | Defined metrics with denominators, recurring mistakes with traceable evidence, strengths and improvements, recommendations, targeted practice from real mistakes, full backup and restore | Available |

## 5. Media Importer

The Media Importer is shared infrastructure, used first by Listening and later by Speaking and Reading.

### 5.1 Supported sources

| Source | Formats | Handling |
| --- | --- | --- |
| Local file | Playback: MP3, WAV, M4A, MP4, WebM, FLAC, OGG, MPGA. Transcription also accepts MPEG (which browsers usually can't play). | Played in the browser through an object URL. **Never uploaded** unless the learner explicitly clicks "Transcribe". |
| YouTube | Public video URL | Played through the official embedded player (`youtube-nocookie.com`). Only the video ID is stored. |
| Subtitles | SRT, WebVTT | Parsed in the browser into timestamped cues. |

### 5.2 Automatic transcription (user-initiated)

- An explicit "Transcribe" action sends a **user-owned or user-authorised local file** through the local server to Groq Whisper. It is available from the Listening page (which creates a new session) and from an existing file session.
- Options: language **English** (default) or **Detect automatically**; model **Fast** (`whisper-large-v3-turbo`, default) or **Higher accuracy** (`whisper-large-v3`).
- The server streams the upload to a temporary file that is deleted when the request ends, including on errors and cancellation. Nothing is stored on the server.
- **Privacy:** the UI states, next to the button, that the recording is sent to Groq, that this app keeps only a temporary copy, and that Groq's own retention is governed by the learner's Groq account settings and policies. The app makes no claim about Groq-side retention.
- The result is a timestamped transcript, re-cut into sentence-sized lines using word timestamps, and saved with its word and segment timings in a new persistent session, ready for read-along or dictation.
- YouTube media is never transcribed, because the application does not access YouTube media streams. A YouTube video can be paired with subtitles the learner is entitled to use.

### 5.3 Validation rules

- Files are accepted by extension and, when the browser reports one, a consistent MIME type. For transcription, the server also checks the file's content signature (magic bytes).
- Local playback size limit: 2 GB, to guard against accidental drops of unrelated files.
- Upload limit for transcription: reported by the server (`/api/capabilities`); 25 MB by default (Groq's free tier), configurable up to 100 MB with `TRANSCRIPTION_MAX_UPLOAD_MB` when the Groq plan allows it. Longer recordings must be shortened or compressed; automatic splitting is planned.
- Subtitle files: up to 5 MB.
- YouTube input accepts standard watch, short-link, embed, live and Shorts URLs, or a bare 11-character video ID.

### 5.4 Speaking Lab

- **Tasks:** a curated library of 14 prompts (technology, work, culture, education, science, society, everyday situations; one B2 and one C1 each), plus learner-created topics. Guided mode shows points to cover and a suggested structure; free mode leaves the organisation to the learner. Suggested durations: 30, 60, 120 or 180 seconds; recording stops at 180 seconds.
- **Recording:** the microphone is requested only when the learner presses "Start recording". Pause, resume, finish and cancel; a live input-level meter warns when no sound is detected; the recording can be played back before anything is sent.
- **Transcription:** an explicit "Transcribe" action sends the recording through the M2 pipeline (English by default).
- **Review:** the learner corrects words the recogniser misheard, per segment, and is told to keep their own mistakes. Feedback is only requested on the confirmed transcript.
- **Feedback:** qualitative levels only (Strong / Developing / Needs attention), never scores or CEFR labels. Every correction shows the original words, a correction, an explanation, an optional more natural alternative, and the timestamp; quotes are verified against the transcript and unverifiable claims are withheld. Fluency is reported as deterministic measurements with their limits stated. Pronunciation, accent and intonation are explicitly not assessed.
- **Exercises:** two to five follow-ups built from the learner's own sentences (correct the error, natural collocation, reformulate, linking, develop the argument), with saved answers and a model answer.

### 5.5 AI exercise generation

Generation happens only when the learner presses a "Generate" button, uses the configured Groq chat model, and every result is validated before it is shown. Generated content is practice material: the level is a target, never presented as an official CEFR assessment. Difficulty comes from the thinking and language a task demands, not from obscure vocabulary (B2: independent communication and varied vocabulary; C1: nuance, precision, complex argument; C2: subtle distinctions, register, idiomatic precision).

- **Speaking tasks** ("Generate with AI" in Your own topics): choose level (B2, C1, C2), category, format (free speaking, guided discussion, debate, critical thinking), suggested duration, an optional language focus and an optional topic or interest. The task has a title, a central prompt, instructions, discussion points, follow-up questions, useful expressions and collocations with meanings and examples, and speaking objectives. **No model answer** is generated, to keep practice spontaneous. The learner previews, regenerates, edits and saves it as a personal topic; curated prompts and hand-written topics are unchanged.
- **Listening comprehension** (the Comprehension mode of a session with a transcript): choose level, question types (main idea, detail, inference, speaker intention, vocabulary in context) and 4–10 questions. Questions are multiple choice or short answer and use the saved transcript as their only source; each carries an exact evidence quote, which the server checks against the transcript together with its segment references. Unverifiable questions are left out, and the learner is told how many. The transcript is hidden while answering; after "Check answers" each question shows the correct or accepted answers, an explanation and the transcript passage with "Play this part". Short answers are self-assessed. Sets and answers are saved; a set can be answered again or deleted. Dictation is not duplicated here.

### 5.6 Writing Lab

- **Tasks:** "Generate a writing task" with level (B2, C1, C2), format (argumentative, opinion and discursive essays; formal and informal emails; report; proposal; article; review; summary; paraphrase; reformulation), topic category, register, target length, and an optional subject and learning objective. A task has a title, instructions, context, a source text for summary/paraphrase/reformulation, a word range, required elements, evaluation criteria, learning objectives and useful language features. No model answer is generated. The learner previews, regenerates, edits and saves it.
- **Editor:** a calm serif writing surface with live word and character counts against the range, the task brief alongside (summarised above the editor on phones), drafts autosaved in the browser and restored after a reload, an optional timer (never required), and draft discarding. Submitting outside the range asks for confirmation.
- **Feedback:** grammar and accuracy, vocabulary range and precision, collocations and naturalness, coherence and cohesion, task achievement, register and formality, and sentence variety, each with a qualitative level, a summary and strengths; required elements checked; priorities. Every correction quotes the exact text (verified), gives a correction, an explanation of why it matters, a category, a priority, and optionally a more sophisticated natural alternative. **Errors** (genuinely wrong) are kept apart from **suggestions** (acceptable text that could be more precise or natural); the model is told never to call a correct sentence wrong because a fancier option exists, and suggestions can't be high priority. Views: inline annotations, the original, the text with only errors fixed, and an optional improved version (a separate request after the assessment, with notes on what changed). Submitted texts can be revised as a new draft or assessed again. Not an official CEFR assessment.

### 5.7 Grammar Lab

- **Sets:** level, one of 12 areas (conditionals and mixed conditionals, inversion, passive voice, modal verbs, relative clauses, participle clauses, reported speech, articles and prepositions, cleft sentences, advanced linking devices, collocations and phrasal verbs, advanced structures), question types (multiple choice, gap filling, error correction, sentence transformation, word ordering, sentence completion), 4–12 questions and an optional narrower focus.
- **Quality:** generated questions are checked automatically; ambiguous or inconsistent ones (duplicate options, invalid keys, a transformation that ignores its keyword, an error correction that changes nothing, a word order that uses other words) are removed and counted.
- **Answering:** answers and explanations stay hidden until "Check answers". Scoring is deterministic: an answer is correct when it matches an accepted answer after ignoring only harmless differences (capitals, quote style, spacing, final punctuation, contracted forms); commas and words still count. After checking: the correct answers, the rule, the explanation and why each option is right or wrong. For open answers that don't match the key, the learner may ask for an AI second opinion against an explicit rubric; it is shown separately and never changes the score. "Try again" starts a new round; every checked round is kept in the history.

### 5.8 Reading Lab

- **Texts:** generated (level B2/C1/C2, topic, text type: feature article, opinion piece, informative article, report or narrative; about 250–800 words; optional interests and language focus) or pasted by the learner (80 words to 20,000 characters; paragraphs from blank lines). No web pages are downloaded and no URL can be imported. Generated texts come with reading objectives and expressions worth noticing (verified to occur in the text); reading time is estimated at 200 words per minute.
- **Reading view:** serif or sans, four text sizes, three line spacings and widths; progress follows the furthest paragraph read; the learner marks a text as finished.
- **Look up:** select up to eight words in one paragraph (or type them) and ask for an analysis of that use in that sentence: meaning here, a definition, part of speech, register, collocations, similar and opposite expressions, examples, patterns and an AI-estimated CEFR level; an optional Portuguese explanation. Save it to the vocabulary collection.
- **Comprehension:** main idea, detail, inference, author's intention, argument analysis, vocabulary in context and implication, in multiple-choice and short-answer form. Every question quotes the text; unverifiable questions, invalid paragraph references and answers that simply copy a sentence are removed. Answers are hidden until "Check answers"; results show explanations and the evidence, which "Show in text" highlights in the passage.

### 5.9 Vocabulary Lab

- **Collection:** one entry per expression (word, phrasal verb, idiom, collocation or expression), keyed by its dictionary form, with one or more contextual meanings, each with its source sentence and text, definition, examples, collocations, synonyms, antonyms, register, patterns and an AI-estimated level. Saving the same meaning again changes nothing; a new meaning is added to the same entry. Search, filters by type and review status, deletion of a meaning or an entry.
- **Review:** due expressions are shown with their context sentence; the learner recalls the meaning, reveals it and rates Again (tomorrow), Good (next step) or Easy (two steps) on a fixed ladder of 0, 1, 3, 7, 16 and 35 days. From about two weeks an expression counts as known.
- **Practice:** from selected expressions or the whole collection: fill in the blank, meaning in context, collocations, matching, sentence completion, paraphrasing and the learner's own sentences. Objective questions are scored against the key; open answers get optional AI feedback against explicit criteria (right meaning, task met, grammatical and natural), shown separately from the score. Retries keep a history.

## 6. Legal and ethical constraints

- YouTube content is only *played* through the official IFrame player, in line with the YouTube Terms of Service.
- No yt-dlp, no stream URL extraction, no scraping.
- Learners may only import and process media they own or are authorised to process. The UI states this at the import point.

## 7. Data and privacy

| Data | Location | Retention |
| --- | --- | --- |
| Preferences (theme) | `localStorage` | Until cleared |
| Imported media | Browser memory (object URL); optional opt-in copy in IndexedDB (≤ 500 MB per file) | Page lifetime, or until the copy or session is deleted |
| Listening sessions, subtitles and transcripts | IndexedDB (`linguas-de-gato` database) | Until deleted by the learner |
| Dictation attempts (last 20 per line) | IndexedDB | Until the session or its transcript is deleted or replaced |
| Recurring mistakes, metrics, insights | Not stored: derived on demand from the records above | — |
| Recommendation decisions (done/dismissed) and the targeted-practice log | IndexedDB | Until deleted (or replaced by an import) |
| Targeted-practice profile (one area's name and description, optionally ≤ 5 of the learner's mistakes with corrections) | Groq (via the local server; not logged), only when the learner presses "Generate targeted practice" | This app: duration of the request only. Groq: per the learner's Groq account settings and Groq's policies |
| Backups | A JSON file the learner downloads; never uploaded | Under the learner's control |
| Generated transcripts (cues, word and segment timings, model and language used) | IndexedDB | Until deleted by the learner |
| Audio sent for transcription | Server temp file (deleted in `finally`; swept at startup after a crash), then Groq | This app: duration of the request only. Groq: per the learner's Groq account settings and Groq's policies |
| Transcription preferences (language, model) | `localStorage` | Until cleared |
| Speaking attempts (prompt, transcript as recognised and as corrected, word timings, fluency, feedback, exercise answers) and custom or AI-generated topics | IndexedDB | Until deleted by the learner |
| Listening exercise sets (generated questions, evidence, answers, results) | IndexedDB | Until the set or its session is deleted (kept, and flagged, if the transcript is replaced) |
| Text sent for exercise generation (speaking settings and optional interest; or the session's transcript text, never audio) | Groq (via the local server; not logged) | This app: duration of the request only. Groq: per the learner's Groq account settings and Groq's policies |
| Writing tasks, drafts (one per task), submitted texts with feedback and improved versions | IndexedDB | Until deleted by the learner (deleting a task deletes its draft; submissions are kept until deleted) |
| Grammar sets, answers, second opinions and result history | IndexedDB | Until the set is deleted |
| Reading texts (generated or pasted), progress and comprehension sets | IndexedDB | Until deleted (deleting a text deletes its question sets) |
| Vocabulary entries, review history and practice sets | IndexedDB | Until deleted by the learner (entries survive deleting the text they came from) |
| Reading preferences, explanation language | `localStorage` | Until cleared |
| Text sent for reading generation, questions (the text), lookups (selection, sentence, paragraph), vocabulary practice and evaluations | Groq (via the local server; not logged) | This app: duration of the request only. Groq: per the learner's Groq account settings and Groq's policies |
| Text sent for writing feedback, improved versions, task generation and grammar second opinions | Groq (via the local server; not logged) | This app: duration of the request only. Groq: per the learner's Groq account settings and Groq's policies |
| Speaking recordings | Browser memory; IndexedDB only if the learner ticks "Keep this recording" | Page lifetime by default; otherwise until the learner deletes the recording or the attempt |
| Transcript sent for speaking feedback | Groq (via the local server; not logged) | This app: duration of the request only. Groq: per the learner's Groq account settings and Groq's policies |
| API keys | Server environment only | Never sent to the browser |

Data export and import: Progress → Data & backups exports every store and preference as one versioned JSON file (media optional and size-limited, omissions listed) and imports a backup after full validation, by merge or by replace (with a safety backup downloaded first), atomically.

### 7.1 Progress rules

- Metrics show their definition and denominator; time is shown only where it is measured (speaking recordings, the optional writing timer); reading time is labelled an estimate; there is no total study time, combined score or CEFR level.
- A mistake is *recurring* at ≥ 4 occurrences from ≥ 2 pieces of work with the latest within 60 days, *preliminary* from 2; a *strength* needs ≥ 6 correct answers from ≥ 2 pieces of work with ≤ 20% errors; *improving* needs clearly fewer mistakes in the last 30 days than in the 90 before.
- Stylistic suggestions, speech-recognition fixes, unchecked work, answers accepted on a second opinion and unrated short answers are never counted as mistakes.

## 8. Experience principles

1. **Calm and focused.** An editorial, typographic interface. Content comes first and chrome stays quiet.
2. **Honest.** Features that do not exist yet are labelled "Planned", never mocked with fake data.
3. **Keyboard-first audio.** Every playback control is reachable and has a shortcut.
4. **Accessible by default.** WCAG 2.2 AA contrast, visible focus, labelled controls, respect for `prefers-reduced-motion`.
5. **Responsive.** Works at 375 px and up, with no horizontal scrolling.

## 9. Assumptions

- A single learner uses the application on their own machine. The server binds to `127.0.0.1` by default.
- The interface language is English. Interface localisation is out of scope for the first milestones, but the *target language* is modelled explicitly from day one.
- A Groq API key is supplied by the learner through the server `.env` file.
