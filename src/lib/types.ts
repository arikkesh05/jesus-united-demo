export interface Reflection {
  id: string;
  title: string;
  scripture_reference: string;
  reflection_text: string;
  audio_url: string | null;
  reflection_date: string;
  created_at: string;
}

export interface Gathering {
  id: string;
  name: string;
  description: string | null;
  leader_name: string;
  contact_email: string | null;
  meeting_time: string;
  address: string;
  latitude?: number;
  longitude?: number;
  distance_meters?: number;
  created_at: string;
}

export interface PulpitKitOutlinePoint {
  section: string;
  subtext: string;
}

export interface PulpitKit {
  id: string;
  title: string;
  theme: string;
  series_name?: string | null;
  scripture_passages: string[];
  outline: PulpitKitOutlinePoint[];
  talking_points: string[];
  discussion_questions: string[];
  key_quote?: string | null;
  call_to_action?: string | null;
  estimated_minutes?: number;
  target_sunday: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Phase 1 — Authenticated community schemas (deterministic, strict).
// Mirrors the Phase 1 tables: profiles, altar_completions, habits,
// gathering_submissions, gathering_attendances, prayer_requests,
// prayer_intercessions.
//
// Conventions:
// - IDs/FKs are UUID v4 strings (Postgres `uuid`).
// - `DatabaseDate` is a Postgres `date` serialized by PostgREST as `YYYY-MM-DD`.
// - `DatabaseTimestamp` is a Postgres `timestamptz` serialized as ISO 8601.
// - Nullable columns are typed `| null`; never use `undefined` for DB nulls.
// ---------------------------------------------------------------------------

/** Postgres `timestamptz` column as returned by PostgREST (ISO 8601 string). */
export type DatabaseTimestamp = string;

/** Postgres `date` column as returned by PostgREST (`YYYY-MM-DD` string). */
export type DatabaseDate = string;

/** One row per believer; mirrors the auth user 1:1 (`id` = `auth.users.id`). */
export interface Profile {
  id: string;
  display_name: string;
  time_zone: string;
  language: string;
  city: string | null;
  country: string | null;
  created_at: DatabaseTimestamp;
}

/** Daily altar tracking: morning/evening devotion completion per local date. */
export interface AltarCompletion {
  id: string;
  user_id: string;
  date: DatabaseDate;
  morning_completed: boolean;
  evening_completed: boolean;
  evening_journal: string | null;
  created_at: DatabaseTimestamp;
}

/** Daily spiritual-discipline minute log (one row per user per date). */
export interface HabitEntry {
  id: string;
  user_id: string;
  date: DatabaseDate;
  prayer_minutes: number;
  bible_reading_minutes: number;
  worship_minutes: number;
  service_minutes: number;
  created_at: DatabaseTimestamp;
}

/** Moderation state for guest-submitted gatherings. */
export type GatheringSubmissionStatus = "pending" | "approved" | "rejected";

/**
 * The guest-provided gathering payload stored in
 * `gathering_submissions.gathering_data` (jsonb). Strictly shaped so
 * approved submissions can be inserted into `gatherings` without inference
 * surprises; lat/long stay nullable until the location is geocoded.
 */
export interface GatheringSubmissionData {
  name: string;
  meeting_time: string;
  address: string;
  leader_name: string;
  description: string | null;
  contact_email: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface GatheringSubmission {
  id: string;
  submitter_name: string;
  submitter_email: string;
  gathering_data: GatheringSubmissionData;
  status: GatheringSubmissionStatus;
  created_at: DatabaseTimestamp;
}

/** Check-in of an authenticated user at a gathering (PostGIS location). */
export interface GatheringAttendance {
  id: string;
  gathering_id: string;
  user_id: string;
  attended_at: DatabaseTimestamp;
}

/** Community prayer wall request; `topics` is a Postgres `text[]` column. */
export interface PrayerRequest {
  id: string;
  user_id: string;
  author_name: string;
  title: string;
  body: string;
  topics: string[];
  is_public: boolean;
  is_answered: boolean;
  answered_note: string | null;
  intercession_count: number;
  created_at: DatabaseTimestamp;
}

/** One "I prayed for this" event; unique per (request_id, user_id) per day. */
export interface PrayerIntercession {
  id: string;
  request_id: string;
  user_id: string;
  prayed_at: DatabaseTimestamp;
}

/** Parameters for the transactional, moderator-only database function. */
export interface ModerateGatheringArgs {
  p_submission_id: string;
  p_action: "approve" | "reject";
}

export interface PrayerVisibilityUpdate {
  is_public: boolean;
}

// ---------------------------------------------------------------------------
// Phase 5 — Production Expansion: live host connect inquiries.
// ---------------------------------------------------------------------------

/**
 * A visitor's connect inquiry for one gathering. Carries **visitor-supplied
 * data only** — the host's private email/phone is resolved server-side (or not
 * at all) and must never be included in, or echoed back through, this payload.
 */
export interface GatheringInquiryPayload {
  /** Public gathering id (the opaque marker id). */
  gathering_id: string;
  /** Visitor's name, as they want the host to address them. */
  visitor_name: string;
  /** Visitor's reply-to channel: an email address or a WhatsApp phone number. */
  contact: string;
  /** Optional note for the host; empty string means "no message". */
  message: string;
}

/** Result of an inquiry submission; failures carry a message, never throw. */
export type GatheringInquiryResult =
  | { ok: true; delivered: "remote" | "simulated" }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Phase 2 — 3D globe schemas (deterministic, strict).
// ---------------------------------------------------------------------------

/**
 * Privacy-preserving marker payload rendered on the public 3D globe.
 *
 * Deliberately minimal: it carries no street address, meeting schedule, email
 * or full leader identity, and `lat`/`lng` are deterministic jittered centroids
 * (see `sanitizeToCentroidWithJitter`), never the exact location.
 */
export interface GlobeMarker {
  id: string;
  city: string;
  first_name: string;
  member_count: number;
  lat: number;
  lng: number;
  /**
   * Optional public role/title (e.g. "Campus Pastor", "Youth Leader") used by
   * the globe to pin an avatar sheet. Deliberately optional: the default
   * privacy-stripped marker feed does not emit it, and the scene falls back to
   * a stable id-hash assignment when it is absent.
   */
  role?: string | null;
}
