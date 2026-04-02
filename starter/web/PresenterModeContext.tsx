import React, { createContext, useContext, useEffect, useState } from 'react';

/**
 * PRODUCTION-QUALITY PRESENTER MODE CONTEXT
 * Focus: Global State Management for UI Privacy
 */

interface PrivacyContextType {
  isPresenterMode: boolean;
  togglePresenterMode: (enabled: boolean) => void;
}

const PrivacyContext = createContext<PrivacyContextType | undefined>(undefined);

export const PrivacyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isPresenterMode, setIsPresenterMode] = useState(false);

  useEffect(() => {
    // Listen for changes from the Electron Shell (e.g., hotkeys)
    const unsubscribe = window.spliceAPI?.onPrivacyChanged((state: boolean) => {
      setIsPresenterMode(state);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const togglePresenterMode = (enabled: boolean) => {
    setIsPresenterMode(enabled);
    // Notify the Electron shell so it can adjust system-level behaviors
    window.spliceAPI?.togglePresenterMode(enabled);
  };

  return (
    <PrivacyContext.Provider value={{ isPresenterMode, togglePresenterMode }}>
      {children}
    </PrivacyContext.Provider>
  );
};

export const usePrivacy = () => {
  const context = useContext(PrivacyContext);
  if (!context) throw new Error('usePrivacy must be used within a PrivacyProvider');
  return context;
};
