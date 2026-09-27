declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    /** The request's only Supabase client, built by the middleware; null when the env is missing. */
    supabase: import("@supabase/supabase-js").SupabaseClient | null;
  }
}
