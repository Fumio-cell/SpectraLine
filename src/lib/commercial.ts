import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) 
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) 
  : null;

export async function signInWithGoogle() {
  if (!supabase) return { data: null, error: new Error('Supabase not configured') };
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
  if (error) console.error('Auth error:', error.message);
  return { data, error };
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Sign out error:', error.message);
}

export async function getUserStatus() {
  try {
    if (!supabase) return { user: { id: 'local-user', email: 'Local Mode' }, isPro: true };
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    // Always return isPro: true for local use
    if (userError || !user) {
      return { user: null, isPro: true };
    }

    return { 
      user, 
      isPro: true 
    };
  } catch (err: any) {
    return { user: null, isPro: true };
  }
}

export function openLemonSqueezyCheckout(userId: string | null = null) {
  console.log('Checkout disabled for local use');
}
