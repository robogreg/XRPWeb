import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import '@/utils/i18n';
import '@/utils/blockly-global'; // Expose Blockly globally for external plugins
import App from '@/App.tsx';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ThemeInit } from '../.flowbite-react/init';

function Root() {
    const [googleClientId, setGoogleClientId] = useState<string | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const googleAuthBackendUrl = import.meta.env.GOOGLE_AUTH_URL;

    useEffect(() => {
        const fetchClientId = async () => {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3000);
                const response = await fetch(`${googleAuthBackendUrl}/google-auth/client-id`, { signal: controller.signal });
                clearTimeout(timeout);
                if (!response.ok) throw new Error(`Failed to fetch client ID: ${response.statusText}`);
                const data = await response.json();
                setGoogleClientId(data.client_id);
            } catch (error) {
                console.warn('Google Auth backend unavailable — running without Google login:', error);
            } finally {
                setAuthReady(true);
            }
        };
        fetchClientId();
    }, []);

    if (!authReady) {
        return <div>Loading...</div>;
    }

    // Always wrap with GoogleOAuthProvider so that useGoogleLogin (used inside Login)
    // never throws "must be used within GoogleOAuthProvider". When no client ID is
    // available the Google sign-in flow simply won't work, but the component renders.
    return (
        <StrictMode>
            <ThemeInit />
            <GoogleOAuthProvider clientId={googleClientId ?? ''}>
                <App />
            </GoogleOAuthProvider>
        </StrictMode>
    );
}

createRoot(document.getElementById('root')!).render(<Root />);
