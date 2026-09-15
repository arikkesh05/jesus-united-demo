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
