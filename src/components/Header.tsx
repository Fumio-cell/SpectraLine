import React, { useEffect, useState } from 'react';
import { supabase, openLemonSqueezyCheckout } from '../lib/commercial';
import { LogIn, LogOut, Zap, Activity } from 'lucide-react';

export const Header: React.FC = () => {
    const [user, setUser] = useState<any>(null);
    const [isPro, setIsPro] = useState(false);

    useEffect(() => {
        const client = supabase;
        if (!client) return;

        client.auth.getUser().then(({ data: { user: foundUser } }) => {
            setUser(foundUser);
            if (foundUser) {
                client
                    .from('profiles')
                    .select('is_pro')
                    .eq('id', foundUser.id)
                    .single()
                    .then(({ data }) => {
                        const pro = !!(data as any)?.is_pro;
                        const finalPro = pro || foundUser?.email === 'fumiotashiro@gmail.com';
                        setIsPro(finalPro);
                        window.dispatchEvent(new CustomEvent('auth:status', { detail: { user: foundUser, isPro: finalPro } }));
                    });
            }
        });

        const { data: authListener } = client.auth.onAuthStateChange(async (_event, session) => {
            const currentUser = session?.user ?? null;
            setUser(currentUser);
            if (currentUser) {
                const { data } = await client
                    .from('profiles')
                    .select('is_pro')
                    .eq('id', currentUser.id)
                    .single();
                const pro = !!(data as any)?.is_pro;
                const finalPro = pro || currentUser?.email === 'fumiotashiro@gmail.com';
                setIsPro(finalPro);
                window.dispatchEvent(new CustomEvent('auth:status', { detail: { user: currentUser, isPro: finalPro } }));
            } else {
                setIsPro(false);
                window.dispatchEvent(new CustomEvent('auth:status', { detail: { user: null, isPro: false } }));
            }
        });

        const handleBuyPro = () => openLemonSqueezyCheckout();
        window.addEventListener('app:buyPro', handleBuyPro);

        return () => {
            authListener?.subscription.unsubscribe();
            window.removeEventListener('app:buyPro', handleBuyPro);
        };
    }, []);

    const login = () => supabase?.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    const logout = () => supabase?.auth.signOut();

    return (
        <header className="toolkit-header">
            <div className="header-left">
                <div className="toolkit-brand">
                    <Activity className="brand-icon" />
                    <span className="toolkit-name">Poetic Signal Toolkit</span>
                </div>
                <div className="app-separator">/</div>
                <div className="app-name">SpectraLine</div>
            </div>

            <div className="header-right">
                {user ? (
                    <div className="user-profile">
                        <div className={`pro-badge ${isPro ? 'active' : ''}`}>
                            <Zap className="w-3 h-3" />
                            {isPro ? 'PRO' : 'FREE'}
                        </div>
                        <span className="user-email">{user.email}</span>
                        {!isPro && (
                            <button onClick={() => openLemonSqueezyCheckout()} className="upgrade-btn">
                                Upgrade
                            </button>
                        )}
                        <button onClick={logout} className="icon-btn" title="Logout">
                            <LogOut className="w-4 h-4" />
                        </button>
                    </div>
                ) : (
                    <button onClick={login} className="login-btn">
                        <LogIn className="w-4 h-4" />
                        Login
                    </button>
                )}
            </div>

            <style>{`
                .toolkit-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.75rem 1.5rem;
                    background: rgba(15, 23, 42, 0.85);
                    backdrop-filter: blur(12px);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                    position: sticky;
                    top: 0;
                    z-index: 1000;
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                }
                .header-left, .header-right {
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                }
                .toolkit-brand {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    color: #38bdf8;
                }
                .brand-icon {
                    width: 1.25rem;
                    height: 1.25rem;
                }
                .toolkit-name {
                    font-weight: 700;
                    letter-spacing: -0.02em;
                    color: #fff;
                }
                .app-separator {
                    color: rgba(255, 255, 255, 0.2);
                    font-weight: 300;
                    margin: 0 0.25rem;
                }
                .app-name {
                    color: rgba(255, 255, 255, 0.7);
                    font-size: 0.95rem;
                    font-weight: 500;
                }
                .user-profile {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    background: rgba(255, 255, 255, 0.06);
                    padding: 0.35rem 0.5rem 0.35rem 0.75rem;
                    border-radius: 9999px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                .pro-badge {
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                    font-size: 0.7rem;
                    font-weight: 800;
                    padding: 0.2rem 0.5rem;
                    border-radius: 9999px;
                    background: rgba(255, 255, 255, 0.1);
                    color: #94a3b8;
                    letter-spacing: 0.05em;
                }
                .pro-badge.active {
                    background: #f59e0b;
                    color: #fff;
                    box-shadow: 0 0 10px rgba(245, 158, 11, 0.3);
                }
                .user-email {
                    font-size: 0.85rem;
                    color: rgba(255, 255, 255, 0.9);
                    font-weight: 500;
                    letter-spacing: 0.01em;
                }
                .upgrade-btn {
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                    color: #fff;
                    border: none;
                    padding: 0.3rem 0.8rem;
                    border-radius: 9999px;
                    font-size: 0.75rem;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 8px rgba(245, 158, 11, 0.25);
                }
                .upgrade-btn:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
                }
                .login-btn {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    background: #fff;
                    color: #0f172a;
                    border: none;
                    padding: 0.5rem 1.25rem;
                    border-radius: 9999px;
                    font-size: 0.85rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 8px rgba(255, 255, 255, 0.1);
                }
                .login-btn:hover {
                    background: #f8fafc;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(255, 255, 255, 0.2);
                }
                .icon-btn {
                    background: none;
                    border: none;
                    color: rgba(255, 255, 255, 0.5);
                    cursor: pointer;
                    padding: 0.4rem;
                    display: flex;
                    align-items: center;
                    border-radius: 50%;
                    transition: all 0.2s ease;
                }
                .icon-btn:hover {
                    color: #fff;
                    background: rgba(255, 255, 255, 0.1);
                }
            `}</style>
        </header>
    );
};
