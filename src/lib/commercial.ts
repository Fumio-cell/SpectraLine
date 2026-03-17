import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function signInWithGoogle() {
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
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Sign out error:', error.message);
}

export async function getUserStatus() {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) return { user: null, isPro: false };

    const { data, error } = await supabase
      .from('profiles')
      .select('is_pro')
      .eq('id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.warn('Profile fetch error:', error.message);
    }

    return { 
      user, 
      isPro: data?.is_pro || false 
    };
  } catch (err: any) {
    console.error('getUserStatus failed:', err.message);
    return { user: null, isPro: false };
  }
}

export function openLemonSqueezyCheckout(userId: string | null = null) {
  // TODO: SpectraLine の実際のチェックアウトURLを設定する
  let checkoutUrl = 'https://yourstore.lemonsqueezy.com/checkout/buy/...';
  
  if (userId) {
    checkoutUrl += (checkoutUrl.includes('?') ? '&' : '?') + `checkout[custom][user_id]=${userId}`;
  }
  
  if ((window as any).createLemonSqueezy) {
    (window as any).createLemonSqueezy();
  }
  
  const LemonSqueezy = (window as any).LemonSqueezy;
  if (typeof LemonSqueezy !== 'undefined') {
    LemonSqueezy.Url.Open(checkoutUrl);
  } else {
    const win = window.open(checkoutUrl, '_blank');
    if (win) win.focus();
  }
}
