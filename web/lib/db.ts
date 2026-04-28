import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://smatbeowzfqsvxdkynjw.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_azyk6PpAemo4pk3PJp66qg_pUoinkkk";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
