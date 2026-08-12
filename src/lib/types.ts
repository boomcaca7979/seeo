export interface DatabaseProject {
  id: string;
  user_id: string;
  name: string;
  domain: string;
  created_at: string;
  updated_at: string;
}

export interface DatabaseProfile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  plan?: string;
  subscription_status?: string;
  subscription_id?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
}
