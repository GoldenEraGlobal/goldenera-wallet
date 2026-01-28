import { PrivacyScreen } from "@capacitor/privacy-screen";

export const privacyScreen = () => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"
    PrivacyScreen.enable({
        android: { dimBackground: true },
        ios: { blurEffect: systemTheme }
    });

    return () => {
        PrivacyScreen.disable()
    }
}