import { AuthProvider } from '../context/AuthContext';
import '../src/styles/globals.css';
import '../src/styles/input.css';

function MyApp({ Component, pageProps }) {
    return (
        <AuthProvider>
            <Component {...pageProps} />
        </AuthProvider>
    );
}

export default MyApp;
