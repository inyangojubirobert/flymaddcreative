import { useEffect } from 'react';

export default function Home() {
  useEffect(() => {
    window.location.href = '/Onedream.html';
  }, []);

  return null;
}

