import { useState } from 'react';
import { generateShareUrls } from '../../lib/onedreamHelpers';

/**
 * Share Button Component - Handles copying link and social media sharing
 * Includes native share API support and fallback to social media URLs
 */
const ShareButton = ({ 
  referralUrl = '', 
  userName = '',
  className = "",
  variant = 'primary', // 'primary', 'secondary', 'compact'
  showSocialButtons = true
}) => {
  const [copied, setCopied] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);

  // Generate social media share URLs
  const shareUrls = generateShareUrls(referralUrl, userName);

  // Handle copying to clipboard
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      // Fallback for browsers that don't support clipboard API
      fallbackCopyTextToClipboard(referralUrl);
    }
  };

  // Fallback copy method
  const fallbackCopyTextToClipboard = (text) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.position = 'fixed';
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      document.execCommand('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Fallback: Failed to copy', err);
    }
    
    document.body.removeChild(textArea);
  };

  // Handle native share API
  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Vote for me in the One Dream Initiative',
          text: `Help ${userName || 'me'} win the One Dream Initiative!`,
          url: referralUrl,
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      // Fallback to showing social media options
      setShowShareMenu(!showShareMenu);
    }
  };

  // Social media share handlers
  const handleSocialShare = (platform) => {
    window.open(shareUrls[platform], '_blank', 'width=600,height=400');
    setShowShareMenu(false);
  };

  // Button variants
  const getButtonStyles = () => {
    const baseStyles = "font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2";
    
    switch (variant) {
      case 'secondary':
        return `${baseStyles} bg-gray-100 hover:bg-gray-200 text-gray-700 focus:ring-gray-500`;
      case 'compact':
        return `${baseStyles} bg-blue-50 hover:bg-blue-100 text-blue-600 text-sm px-3 py-2 focus:ring-blue-500`;
      default:
        return `${baseStyles} bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500`;
    }
  };

  const buttonStyles = getButtonStyles();
  const padding = variant === 'compact' ? 'px-3 py-2' : 'px-6 py-3';

  if (variant === 'compact') {
    return (
      <div className={`relative ${className}`}>
        <button
          onClick={handleCopyLink}
          className={`${buttonStyles} ${padding} flex items-center space-x-2`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* Main Share Buttons */}
      <div className="space-y-3">
        {/* Copy Link Button */}
        <button
          onClick={handleCopyLink}
          className={`${buttonStyles} ${padding} w-full flex items-center justify-center space-x-2`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span>{copied ? 'Link Copied!' : 'Copy Referral Link'}</span>
        </button>

        {/* Native Share / Social Share Button */}
        <button
          onClick={handleNativeShare}
          className={`${buttonStyles} ${padding} w-full flex items-center justify-center space-x-2 bg-yellow-500 hover:bg-yellow-600 focus:ring-yellow-500`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
          </svg>
          <span>Share Now</span>
        </button>
      </div>

      {/* Social Media Options (shown when native share not available) */}
      {showShareMenu && showSocialButtons && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
          <div className="p-4">
            <p className="text-sm font-medium text-gray-900 mb-3">Share on:</p>
            <div className="space-y-2">
              {/* Twitter */}
              <button
                onClick={() => handleSocialShare('twitter')}
                className="w-full flex items-center space-x-3 p-2 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                  </svg>
                </div>
                <span className="text-sm font-medium">Twitter</span>
              </button>

              {/* Facebook */}
              <button
                onClick={() => handleSocialShare('facebook')}
                className="w-full flex items-center space-x-3 p-2 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </div>
                <span className="text-sm font-medium">Facebook</span>
              </button>

              {/* WhatsApp */}
              <button
                onClick={() => handleSocialShare('whatsapp')}
                className="w-full flex items-center space-x-3 p-2 hover:bg-green-50 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488"/>
                  </svg>
                </div>
                <span className="text-sm font-medium">WhatsApp</span>
              </button>

              {/* Email */}
              <button
                onClick={() => window.location.href = shareUrls.email}
                className="w-full flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="text-sm font-medium">Email</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay to close menu when clicking outside */}
      {showShareMenu && (
        <div 
          className="fixed inset-0 z-0"
          onClick={() => setShowShareMenu(false)}
        ></div>
      )}
    </div>
  );
};

/**
 * Quick Share Bar - Horizontal layout with social icons
 */
export const QuickShareBar = ({ referralUrl = '', userName = '', className = "" }) => {
  const shareUrls = generateShareUrls(referralUrl, userName);
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const socialButtons = [
    { name: 'Twitter', url: shareUrls.twitter, color: 'bg-blue-500', icon: '🐦' },
    { name: 'Facebook', url: shareUrls.facebook, color: 'bg-blue-600', icon: '📘' },
    { name: 'WhatsApp', url: shareUrls.whatsapp, color: 'bg-green-500', icon: '💬' },
  ];

  return (
    <div className={`flex items-center space-x-3 ${className}`}>
      {/* Copy button */}
      <button
        onClick={handleCopyLink}
        className="flex items-center space-x-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <span>{copied ? 'Copied!' : 'Copy'}</span>
      </button>

      {/* Social buttons */}
      {socialButtons.map((social, index) => (
        <button
          key={index}
          onClick={() => window.open(social.url, '_blank', 'width=600,height=400')}
          className={`w-10 h-10 ${social.color} hover:opacity-80 rounded-lg flex items-center justify-center text-white text-sm transition-opacity`}
          title={`Share on ${social.name}`}
        >
          {social.icon}
        </button>
      ))}
    </div>
  );
};

export default ShareButton;