# Udemy Internal API — Reverse-Engineered Reference

Udemy's **official Instructor API** (`instructor-api/v1`) is read-only analytics:
courses, ratings, reviews, Q&A. Everything else in this project — enrollment,
revenue, coupons, captions, and full course authoring — goes through Udemy's
**internal `api-2.0`**, the same endpoints the website's own React frontend calls.

This document records the endpoints and payloads discovered for this project so
they can be reused or re-verified. All were confirmed against a live account.

## Why a headed browser is required

`api-2.0` sits behind **Cloudflare**, which blocks plain server requests and
headless browsers but lets a real, visible Chrome through. So every call here is
issued **from inside a Playwright page** via `page.evaluate(fetch(...))`, carrying:

- the logged-in **session cookies** (from `udemy-auth.json` storage state),
- the **`csrftoken` cookie** echoed as the `X-CSRFToken` header,
- **`X-Requested-With: XMLHttpRequest`** (required by the authoring endpoints),
- and, for authoring writes, the request must originate from the course's
  **`/manage/curriculum/` page** (Udemy enforces a referer/origin check — calls
  from a blank page return **403**).

The typical flow: launch headed → `goto` the manage page → warm up (~4 s so
Cloudflare clears) → issue `fetch` calls from that page context.

---

## Reads (data the official API lacks)

| Data | Endpoint |
|---|---|
| Caption languages | `GET api-2.0/users/me/taught-courses/?fields[course]=caption_locales` |
| Per-lecture captions | `GET api-2.0/users/me/subscribed-courses/{courseId}/lectures/{id}/?fields[lecture]=asset&fields[asset]=captions&fields[caption]=url,locale_id,title` |
| Revenue (lifetime + **monthly series**) | `GET api-2.0/share-holders/v2.0/{shareHolderId}/total/` → `.items[]` is a full month-by-month history |
| Active coupons | `GET api-2.0/courses/{numId}/coupons-v2/?invalid=false` |
| Curriculum (read) | `GET api-2.0/courses/{courseId}/instructor-curriculum-items/` (items have `_class`: `chapter` \| `lecture` \| `quiz` \| `role-play`) |

> Note: the revenue `monthly` series already exists in `revenue-cache.json` and
> powers the "Revenue Over Time" chart via `GET /api/revenue/monthly`. No daily
> snapshotting was needed for revenue history.

---

## Course authoring (writes)

All writes require the manage-page context + headers described above.

### Create a course (draft)
```
POST api-2.0/courses/
→ 201, returns { id }   (lands as an unpublished DRAFT)
```
The website drives a 4-step wizard (type → title → category → time commitment),
but the underlying create is this single POST.

### Sections & lectures
Created under the **taught-courses** path (NOT `instructor-curriculum-items`,
which is read/reorder only):
```
POST api-2.0/users/me/taught-courses/{courseId}/chapters/   { title, description }
POST api-2.0/users/me/taught-courses/{courseId}/lectures/   { title, description }
DELETE api-2.0/users/me/taught-courses/{courseId}/chapters|lectures/{id}/
```
New items **append to the end** of the curriculum, so creating in the desired
order (chapter, its lectures, next chapter, …) yields the correct final layout.
A fresh course ships with one default "Introduction" chapter + lecture — delete
them for a clean slate.

Reorder (from the website) is a single:
```
PUT api-2.0/courses/{courseId}/instructor-curriculum-items/
  { items: "[{id, class, is_published}, ...]" }   // note: items is a JSON *string*
```

### Quizzes
```
POST   api-2.0/courses/{courseId}/quizzes/        { title, description, type:"simple-quiz" } → 201 { id }
```
> The parallel `users/me/taught-courses/{id}/quizzes/` path 404s — quizzes create
> under `courses/{id}/`, unlike chapters/lectures.

Questions ("assessments") are added to a quiz:
```
POST api-2.0/quizzes/{quizId}/assessments/
{
  "_class": "assessment",
  "assessment_type": "multiple-choice",
  "prompt": {
    "question":  "<p>…</p>",              // HTML
    "answers":   ["<p>A</p>", "<p>B</p>", "<p>C</p>", "<p>D</p>"],
    "feedbacks": ["<p>…</p>", "<p>…</p>", "<p>…</p>", ""]   // per-answer, HTML, "" = none
  },
  "correct_response": ["b"],              // lowercase letter(s) of the correct answer(s)
  "question_plain": "…"                   // plain-text mirror of the prompt
}
```

### AI Role-plays
```
POST  api-2.0/courses/{courseId}/role-plays/           → 201 { id }   (saves the title only)
PATCH api-2.0/courses/{courseId}/role-plays/{id}/      (fills the content — create-then-edit)
GET   api-2.0/courses/{courseId}/role-plays/{id}/      (read full object)
```
The content object:
```
{
  "title": "…",
  "scenario": "<p>…</p>",                 // HTML, multi-paragraph
  "learner_role": "…",                    // plain text
  "meeting": {
    "title": "…",
    "duration": 10,                        // minutes
    "goals": [ { "description": "…" }, … ]
  },
  "ai_character": {
    "name": "…", "role": "…",
    "details": "<p>…</p>",                 // personality/background, HTML
    "first_message": "…",                  // opening line, plain text
    "avatar": { "id": 2, "name": "Character 2", "image_url": "instructor/role-play/examples/…",
                "voice_option": "<elevenlabs-voice-id>", "voice_provider": "ELEVENLABS",
                "interactive_props": { "id": 0 } }
  },
  "type": "MANUALLY_CREATED"
}
```
Avatars/voices are **presets** — pick the right avatar + voice per character in
the builder afterward (there is no free-text avatar field).

---

## Captions (write + auto-publish)

Uploading a translated `.vtt` and getting Udemy to auto-publish it is a 4-step
S3 Fine-Uploader flow, all issued in-page:

1. `POST api-2.0/s3-upload-signatures/` — get a signed policy.
2. `POST https://{bucket}.s3.amazonaws.com/` — multipart upload of the `.vtt`.
   The form includes a **static `AWSAccessKeyId`** — this is Udemy's *public*
   bucket-uploader key (shipped to every browser), not a private credential.
3. `POST api-2.0/courses/{courseId}/assets/{assetId}/draft-captions/` — register
   the uploaded file as a draft caption for a locale.
4. Poll `GET …/draft-captions/{id}/?fields[draft_caption]=status,published_caption_id`
   until `published_caption_id` appears — Udemy auto-publishes it.

Idempotency: check existing locale captions first
(`GET api-2.0/courses/{courseId}/captions/?locale=…`) and skip lectures that
already have that locale. See `server/localizeCaptions.js` for the full pipeline
(download English source → free Google-translate in batches → upload → publish).

---

## Coupons (write)
```
POST api-2.0/courses/{numId}/coupons-v2/
  { code, discount_value, discount_strategy, maximum_uses, ... }
```
A wrong payload returns 400 and creates nothing, so it's safe to probe. Udemy
caps free coupons at roughly one per course per month.

---

## Gotchas summary

- Authoring writes **403** unless issued from the `/manage/curriculum/` page context.
- `chapters`/`lectures` live under `users/me/taught-courses/{id}/`; `quizzes` and
  `role-plays` live under `courses/{id}/`. Don't assume one path shape.
- Role-play create saves only the title — you **must** PATCH the content after.
- `correct_response` uses lowercase answer letters (`["b"]`), not indices.
- Reorder's `items` field is a JSON **string**, not an array.
- Expect intermittent `TypeError: Failed to fetch` from Cloudflare — retry with
  backoff (all production scripts here already do).
