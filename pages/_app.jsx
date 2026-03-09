import { AuthProvider } from '../context/AuthContext';
import { MerchantAuthProvider } from '../context/MerchantAuthContext';
import '../src/styles/globals.css';
import '../src/styles/input.css';

function MyApp({ Component, pageProps }) {
    return (
        <AuthProvider>
              <MerchantAuthProvider>
            <Component {...pageProps} />
            </MerchantAuthProvider>
        </AuthProvider>
    );
}

export default MyApp;
