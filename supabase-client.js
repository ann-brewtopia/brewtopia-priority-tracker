// ============================================================================
// Supabase client setup
// ============================================================================
// Fill these in once the Supabase project exists (Project Settings → API).
// The anon key is meant to be public — it's safe to ship in client-side code
// because Row Level Security (see supabase_schema.sql) is what actually
// controls who can read/write what, not this key.
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// "Remember me" — a real implementation, not a decorative checkbox. Supabase
// always persists a session somewhere; the question is just *where*.
// Checked = localStorage (survives closing the browser). Unchecked =
// sessionStorage (gone once the tab/browser closes). Whichever the person
// picked on the login screen is written here BEFORE sign-in, so the client
// below reads it and stores the new session in the right place.
const REMEMBER_ME_PREF_KEY = 'pt_remember_me';

function setRememberMePreference(remember){
  try{ localStorage.setItem(REMEMBER_ME_PREF_KEY, remember ? 'true' : 'false'); }catch(e){}
}

const rememberAwareStorage = {
  getItem(key){
    const remember = localStorage.getItem(REMEMBER_ME_PREF_KEY) !== 'false'; // default: remembered
    return (remember ? window.localStorage : window.sessionStorage).getItem(key);
  },
  setItem(key, value){
    const remember = localStorage.getItem(REMEMBER_ME_PREF_KEY) !== 'false';
    (remember ? window.localStorage : window.sessionStorage).setItem(key, value);
  },
  removeItem(key){
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }
};

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: rememberAwareStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
