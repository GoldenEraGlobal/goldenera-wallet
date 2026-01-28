import { Capacitor } from "@capacitor/core";

/**
 * Platform types for device detection
 * - ios: Native iOS app via Capacitor
 * - android: Native Android app via Capacitor
 * - pwa-ios: PWA installed on iOS
 * - pwa-android: PWA installed on Android
 * - extension: Chrome/browser extension
 * - web: Regular web browser (fallback)
 */
export type PlatformType =
    | 'ios'
    | 'android'
    | 'pwa-ios'
    | 'pwa-android'
    | 'web-ios'
    | 'web-android'
    | 'extension'
    | 'web';

// Cached platform value - set once during app initialization
let cachedPlatform: PlatformType | null = null;

/**
 * Detects if running in PWA mode (installed as standalone app)
 */
const isPwaInstalled = (): boolean => {
    if (typeof window === 'undefined') return false;

    // Check display-mode media query (most reliable)
    if (window.matchMedia('(display-mode: standalone)').matches) {
        return true;
    }

    // iOS Safari specific check
    if ('standalone' in window.navigator && (window.navigator as Navigator & { standalone?: boolean }).standalone === true) {
        return true;
    }

    // Check if running in window without browser UI (Android)
    if (window.matchMedia('(display-mode: fullscreen)').matches) {
        return true;
    }

    return false;
};

/**
 * Detects if the device is iOS based on user agent
 */
export const isIosUserAgent = (): boolean => {
    if (typeof window === 'undefined') return false;

    const userAgent = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(userAgent) ||
        (userAgent.includes('mac') && 'ontouchend' in document);
};

/**
 * Detects if the device is Android based on user agent
 */
export const isAndroidUserAgent = (): boolean => {
    if (typeof window === 'undefined') return false;

    return /android/i.test(window.navigator.userAgent);
};

export const definePlatform = (isExtension: boolean = false) => {
    cachedPlatform = detectPlatform(isExtension);
};

/**
 * Detects the current platform/device type.
 * Result is cached after first detection.
 */
export const detectPlatform = (isExtension: boolean = false): PlatformType => {
    // Return cached value if available (unless it's extension check)
    if (cachedPlatform !== null && !isExtension) {
        return cachedPlatform;
    }

    let platform: PlatformType;

    // Extension takes priority if explicitly set
    if (isExtension) {
        platform = 'extension';
    }
    // Check for native Capacitor app first
    else if (Capacitor.isNativePlatform()) {
        const capacitorPlatform = Capacitor.getPlatform();
        if (capacitorPlatform === 'ios') {
            platform = 'ios';
        } else if (capacitorPlatform === 'android') {
            platform = 'android';
        } else {
            platform = 'web';
        }
    }
    // Check for PWA
    else if (isPwaInstalled()) {
        if (isIosUserAgent()) {
            platform = 'pwa-ios';
        } else if (isAndroidUserAgent()) {
            platform = 'pwa-android';
        } else {
            // PWA on desktop fallback to web
            platform = 'web';
        }
    }
    // Fallback to regular web
    else {
        if (isIosUserAgent()) {
            platform = 'web-ios';
        } else if (isAndroidUserAgent()) {
            platform = 'web-android';
        } else {
            platform = 'web';
        }
    }

    return platform;
};

/**
 * Gets the currently detected platform.
 * Must call detectPlatform() first or this will auto-detect.
 */
export const getPlatform = (): PlatformType => {
    if (cachedPlatform === null) {
        return detectPlatform();
    }
    return cachedPlatform;
};

// ============================================================================
// Direct platform check functions (auto-detect platform, no argument needed)
// ============================================================================

/**
 * Returns true if running in native Capacitor app (iOS or Android)
 */
export const isNative = (): boolean => {
    const platform = getPlatform();
    return platform === 'ios' || platform === 'android';
};

/**
 * Returns true if running as PWA (iOS or Android)
 */
export const isPwa = (): boolean => {
    const platform = getPlatform();
    return platform === 'pwa-ios' || platform === 'pwa-android';
};

/**
 * Returns true if running on iOS (native or PWA)
 */
export const isIos = (): boolean => {
    const platform = getPlatform();
    return platform === 'ios' || platform === 'pwa-ios';
};

/**
 * Returns true if running on Android (native or PWA)
 */
export const isAndroid = (): boolean => {
    const platform = getPlatform();
    return platform === 'android' || platform === 'pwa-android';
};

/**
 * Returns true if running on mobile device (native or PWA, not web/extension)
 */
export const isMobile = (): boolean => {
    const platform = getPlatform();
    return platform !== 'web' && platform !== 'extension';
};

/**
 * Returns true if running in regular web browser
 */
export const isWeb = (): boolean => {
    const platform = getPlatform();
    return platform === 'web';
};

/**
 * Returns true if running as browser extension
 */
export const isExtension = (): boolean => {
    const platform = getPlatform();
    return platform === 'extension';
};

/**
 * Returns true if the platform is NOT iOS (native or PWA).
 * Useful for features like history sync that don't work well on iOS.
 */
export const isNotIos = (): boolean => {
    return !isIos();
};

/**
 * Returns true if web renderer should be used (web or extension).
 * For native apps and PWAs, use basic renderer.
 */
export const shouldUseWebRenderer = (): boolean => {
    return !isNative();
};

/**
 * Gets the appropriate UI theme based on device user agent.
 * Returns 'cupertino' for iOS devices, 'android' for others.
 */
export const getTheme = (): 'cupertino' | 'android' => {
    return isIosUserAgent() ? 'cupertino' : 'android';
};


export type DeviceType = 'safari' | 'safari-26' | 'samsung' | 'firefox' | 'unknown'

export const getDeviceType = (): DeviceType => {
    const userAgent = navigator.userAgent
    const isSamsungBrowser = userAgent.match(/SamsungBrowser/i)
    const isSafariBrowser = /(iPhone)/i.test(userAgent) && !!userAgent.match(/Version\/[\d\.]+.*Safari/)
    const isSafari26Plus = /(iPhone)/i.test(userAgent) && !!userAgent.match(/Version\/(2[6-9]|[3-9]\d)[\d\.]*.*Safari/)
    const isFirefox = /Android.+Firefox\//.test(userAgent)
    if (isSamsungBrowser) {
        return 'samsung'
    }
    if (isSafari26Plus) {
        return 'safari-26'
    }
    if (isSafariBrowser) {
        return 'safari'
    }
    if (isFirefox) {
        return 'firefox'
    }
    return 'unknown'
}
