import React from 'react';
import { usePrivacy } from './PresenterModeContext';

/**
 * PRODUCTION-QUALITY REDACT COMPONENT
 * Focus: High-quality masking/blurring of sensitive information
 */

interface RedactProps {
  value: string;
  type?: 'text' | 'token' | 'email' | 'id';
  className?: string;
  fallback?: string;
}

export const Redact: React.FC<RedactProps> = ({ 
  value, 
  type = 'text', 
  className = '', 
  fallback = '••••' 
}) => {
  const { isPresenterMode } = usePrivacy();

  if (!isPresenterMode) {
    return <span className={className}>{value}</span>;
  }

  // --- Masking Logic for Presenter Mode ---

  const getMaskedContent = () => {
    switch (type) {
      case 'token':
        // Show sk- prefix, then redact the rest
        if (value.startsWith('sk-')) return 'sk-••••••••••••';
        return fallback;
      
      case 'email':
        // Mask the first part of the email
        const [user, domain] = value.split('@');
        if (user && domain) return `•••••@${domain}`;
        return fallback;
      
      case 'id':
        // Mask UUID/ID characters
        return `${value.slice(0, 4)}... (Hidden)`;
      
      default:
        // Use a high-quality CSS blur for general text
        return (
          <span 
            className={`blur-[4px] select-none pointer-events-none opacity-60 ${className}`} 
            aria-hidden="true"
          >
            {value}
          </span>
        );
    }
  };

  return (
    <span 
      className={`transition-all duration-300 ${className}`}
      title={isPresenterMode ? 'Privacy Mask Enabled' : undefined}
    >
      {getMaskedContent()}
    </span>
  );
};
