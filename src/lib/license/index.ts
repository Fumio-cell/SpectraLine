/**
 * License check against Lemon Squeezy. One build serves the free preview and the full version; "unlocked" is
 * decided at run time by a stored license. This module imports nothing from the rest of the app.
 */
import { create } from 'zustand';
import { STORE_ID, APP_PRODUCT_IDS, BUNDLE_PRODUCT_IDS } from './config';

export { CHECKOUT_URL } from './config';

const API = 'https://api.lemonsqueezy.com/v1/licenses/';
const STORAGE_KEY = 'spectraline.license';
const DAY = 86_400_000;
const REVALIDATE_AFTER = 7 * DAY;
const LOCK_AFTER = 30 * DAY;

export const MESSAGES = {
    notSetUp: 'License check is not set up yet.',
    empty: 'Enter your license key.',
    network: 'Could not reach the license server. Check your connection.',
    otherProduct: 'This key is for a different product.',
    refused: 'This key could not be activated.'
};

interface Stored { license_key: string; instance_id: string; lastValidatedAt: number }

/** The parts of Lemon Squeezy's replies this module reads. */
interface Reply {
    activated?: boolean;
    valid?: boolean;
    error?: string | null;
    instance?: { id?: string } | null;
    meta?: { store_id?: number; product_id?: number } | null;
}

interface LicenseState {
    unlocked: boolean;
    /** Last four characters of the active key. */
    keyTail: string;
    busy: boolean;
    error: string | null;
}

export const useLicense = create<LicenseState>(() => ({ unlocked: false, keyTail: '', busy: false, error: null }));

/** The license in force (or, after 30 days without a check, waiting to be checked). */
let current: Stored | null = null;
let started = false;

function readStored(): Stored | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw) as Partial<Stored> | null;
        if (s && typeof s.license_key === 'string' && s.license_key && typeof s.instance_id === 'string' && s.instance_id
            && typeof s.lastValidatedAt === 'number' && Number.isFinite(s.lastValidatedAt)) return s as Stored;
    } catch { /* storage is unavailable or the record is damaged: treat as no license */ }
    return null;
}

function writeStored(s: Stored) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* the license then lasts this session only */ }
}

function clearStored() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to clear */ }
}

function setLicense(s: Stored | null) {
    current = s;
    useLicense.setState({ unlocked: s !== null, keyTail: s ? s.license_key.slice(-4) : '' });
}

async function post(path: string, fields: Record<string, string>): Promise<Reply | null> {
    try {
        const res = await fetch(API + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams(fields)
        });
        const data: unknown = await res.json();
        return data && typeof data === 'object' ? data as Reply : null;
    } catch {
        return null;
    }
}

function configured(): boolean {
    const ids = [STORE_ID, ...APP_PRODUCT_IDS, ...BUNDLE_PRODUCT_IDS];
    return APP_PRODUCT_IDS.length > 0 && ids.every(id => id !== null);
}

function browserName(): string {
    const ua = navigator.userAgent;
    return /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'this browser';
}

/** Call once at start. Reads the stored license, then re-checks it if it is more than 7 days old. */
export async function initLicense(): Promise<void> {
    if (started) return;
    started = true;
    const stored = readStored();
    if (!stored) return;
    const age = Math.max(0, Date.now() - stored.lastValidatedAt);
    // Past 30 days without a successful check the app stays locked until one succeeds.
    if (age <= LOCK_AFTER) setLicense(stored); else current = stored;
    if (age <= REVALIDATE_AFTER) return;
    const r = await post('validate', { license_key: stored.license_key, instance_id: stored.instance_id });
    if (current?.instance_id !== stored.instance_id) return; // changed while the request was out
    if (r?.valid === true) {
        const fresh = { ...stored, lastValidatedAt: Date.now() };
        writeStored(fresh);
        setLicense(fresh);
    } else if (r?.valid === false) {
        clearStored();
        setLicense(null);
    } // no usable answer: keep what we had
}

export function clearLicenseError() {
    useLicense.setState({ error: null });
}

function stop(error: string | null) {
    useLicense.setState({ busy: false, error });
}

export async function activate(rawKey: string): Promise<void> {
    if (useLicense.getState().busy) return;
    const key = rawKey.trim();
    if (!configured()) return stop(MESSAGES.notSetUp);
    if (!key) return stop(MESSAGES.empty);
    useLicense.setState({ busy: true, error: null });
    const r = await post('activate', { license_key: key, instance_name: `SpectraLine on ${browserName()}` });
    if (!r || (r.activated === undefined && !r.error)) return stop(MESSAGES.network);
    const instanceId = r.instance?.id;
    if (r.activated !== true || !instanceId) return stop(r.error || MESSAGES.refused);
    const rightStore = Number(r.meta?.store_id) === STORE_ID;
    const rightProduct = [...APP_PRODUCT_IDS, ...BUNDLE_PRODUCT_IDS].includes(Number(r.meta?.product_id));
    if (!rightStore || !rightProduct) {
        // A real key for something else: give the activation slot back at once.
        await post('deactivate', { license_key: key, instance_id: instanceId });
        return stop(MESSAGES.otherProduct);
    }
    const stored = { license_key: key, instance_id: instanceId, lastValidatedAt: Date.now() };
    writeStored(stored);
    setLicense(stored);
    stop(null);
}

export async function deactivate(): Promise<void> {
    if (!current || useLicense.getState().busy) return;
    useLicense.setState({ busy: true, error: null });
    const r = await post('deactivate', { license_key: current.license_key, instance_id: current.instance_id });
    if (!r) return stop(MESSAGES.network); // keep the license: the slot is still in use
    clearStored();
    setLicense(null);
    stop(null);
}
