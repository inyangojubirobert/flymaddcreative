export default function Home() {
    // Redirect to Onedream.html
    if (typeof window !== 'undefined') {
        window.location.href = '/Onedream.html';
    }
    return null;
}
