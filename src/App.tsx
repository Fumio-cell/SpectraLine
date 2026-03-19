import { useState, useCallback, useEffect } from 'react';
import './App.css';
import LeftPanel from './components/LeftPanel';
import Viewer from './components/Viewer';
import Inspector from './components/Inspector';
import { Header } from './components/Header';
import { AppEngine } from './core/engine';
import { useAppStore } from './store/useAppStore';
import { openLemonSqueezyCheckout, signInWithGoogle } from './lib/commercial';

type ViewTab = 'Original' | 'Maps' | 'Lines' | 'Compare';

function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('Lines');
  const [engine, setEngine] = useState<AppEngine | null>(null);
  const [userStatus, setUserStatus] = useState<{ user: any, isPro: boolean }>({ user: null, isPro: false });
  
  const activePresetId = useAppStore(state => state.activePresetId);
  const applyPreset = useAppStore(state => state.applyPreset);
  const presets = useAppStore(state => state.manifest.presets);

  const handleEngineReady = useCallback((eng: AppEngine) => {
    setEngine(eng);
  }, []);

  const handleAuthStatus = useCallback((e: any) => {
    setUserStatus(e.detail);
  }, []);

  useEffect(() => {
    window.addEventListener('auth:status', handleAuthStatus as EventListener);
    return () => window.removeEventListener('auth:status', handleAuthStatus as EventListener);
  }, [handleAuthStatus]);

  useEffect(() => {
    const handleBuyPro = () => {
      if (!userStatus.user) {
        alert('Please login first to upgrade to PRO.');
        signInWithGoogle();
        return;
      }
      openLemonSqueezyCheckout(userStatus.user.id);
    };

    const handleGatedAction = (action: () => Promise<void>) => {
      if (!userStatus.isPro) {
        if (confirm('This is a PRO feature. Would you like to upgrade now?')) {
          handleBuyPro();
        }
        return;
      }
      action();
    };

    const handleExport = async () => {
      if (!engine) return;
      handleGatedAction(async () => {
        const state = useAppStore.getState();
        const input = state.manifest.input;
        const params = state.manifest.params;

        if (!input.file) {
          alert('Please import an image first.');
          return;
        }

        try {
          await engine.exportPNG(params);
        } catch (err: any) {
          alert(`Export failed: ${err.message}`);
        }
      });
    };

    const handleExportMap = async () => {
      if (!engine) return;
      handleGatedAction(async () => {
        try {
          await engine.exportMapPNG();
        } catch (err: any) {
          alert(`Export map failed: ${err.message}`);
        }
      });
    };

    window.addEventListener('app:export', handleExport);
    window.addEventListener('app:exportMap', handleExportMap);
    window.addEventListener('app:buyPro', handleBuyPro);

    return () => {
      window.removeEventListener('app:export', handleExport);
      window.removeEventListener('app:exportMap', handleExportMap);
      window.removeEventListener('app:buyPro', handleBuyPro);
    };
  }, [engine, userStatus]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg-color)' }}>
      <Header />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left Panel */}
      <div style={{ width: '280px', minWidth: '280px', borderRight: '1px solid var(--panel-border)', backgroundColor: 'var(--panel-bg)', overflowY: 'auto' }}>
        <LeftPanel />
      </div>

      {/* Center - Viewer */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top Bar with Presets */}
        <div style={{ height: '48px', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px', borderBottom: '1px solid var(--panel-border)', backgroundColor: 'var(--panel-bg)', flexShrink: 0 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginRight: '8px' }}>Preset:</span>
          {presets.map(p => (
            <button
              key={p.presetId}
              onClick={() => applyPreset(p.presetId)}
              style={{
                padding: '4px 12px',
                borderRadius: '6px',
                border: activePresetId === p.presetId ? '1px solid var(--accent-color)' : '1px solid var(--panel-border)',
                backgroundColor: activePresetId === p.presetId ? 'rgba(100, 108, 255, 0.15)' : 'transparent',
                color: activePresetId === p.presetId ? 'var(--accent-color)' : 'var(--text-main)',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* Viewer */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Viewer
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onEngineReady={handleEngineReady}
          />
        </div>
      </div>

      {/* Right Panel - Inspector */}
      <div style={{ width: '320px', minWidth: '320px', borderLeft: '1px solid var(--panel-border)', backgroundColor: 'var(--panel-bg)', overflowY: 'auto' }}>
        <Inspector />
      </div>
    </div>
  </div>
);
}

export default App;
