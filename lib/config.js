/**
 * 🔐 Secure Configuration Manager
 * Loads environment variables safely for browser and server
 */

// For browser-side usage (client-side)
export const getClientConfig = () => {
  // Check if we're in browser environment
  if (typeof window === 'undefined') {
    throw new Error('getClientConfig should only be called in browser environment');
  }

  // These should be set as NEXT_PUBLIC_ variables or loaded via a secure endpoint
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || 
                 window.ENV?.SUPABASE_URL ||
                 (() => { throw new Error('SUPABASE_URL not configured') })(),
    
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
                     window.ENV?.SUPABASE_ANON_KEY ||
                     (() => { throw new Error('SUPABASE_ANON_KEY not configured') })(),
  };
};

// For server-side usage (Node.js, Edge functions)
export const getServerConfig = () => {
  return {
    supabaseUrl: process.env.SUPABASE_URL ||
                 (() => { throw new Error('SUPABASE_URL not configured') })(),
    
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ||
                     (() => { throw new Error('SUPABASE_ANON_KEY not configured') })(),
    
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ||
                        (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured') })(),
  };
};

// For HTML files - load config from meta tags or fetch from endpoint
export const getHtmlConfig = async () => {
  // Try to get from meta tags first
  const urlMeta = document.querySelector('meta[name="supabase-url"]');
  const keyMeta = document.querySelector('meta[name="supabase-key"]');
  
  if (urlMeta && keyMeta) {
    return {
      supabaseUrl: urlMeta.getAttribute('content'),
      supabaseAnonKey: keyMeta.getAttribute('content'),
    };
  }
  
  // Fallback: fetch from secure endpoint
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Failed to fetch config');
    return await response.json();
  } catch (error) {
    console.error('Failed to load configuration:', error);
    throw new Error('Configuration not available');
  }
};

// Development mode check
export const isDevelopment = () => {
  return process.env.NODE_ENV === 'development' ||
         process.env.NEXT_PUBLIC_NODE_ENV === 'development' ||
         (typeof window !== 'undefined' && window.location.hostname === 'localhost');
};

export default {
  getClientConfig,
  getServerConfig,
  getHtmlConfig,
  isDevelopment,
};