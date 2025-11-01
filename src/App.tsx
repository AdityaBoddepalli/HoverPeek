import React, { useState, useEffect } from 'react';

interface AIStatus {
  summarizer: string;
  languageModel: string;
}

const App: React.FC = () => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [aiStatus, setAiStatus] = useState<AIStatus>({ summarizer: 'checking', languageModel: 'checking' });
  const [summarizerProgress, setSummarizerProgress] = useState(0);
  const [languageModelProgress, setLanguageModelProgress] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  useEffect(() => {
    // Load saved state
    chrome.storage.local.get(['linkPreviewEnabled'], (result) => {
      if (result.linkPreviewEnabled === undefined) {
        // Default to off on first install
        setIsEnabled(false);
        chrome.storage.local.set({ linkPreviewEnabled: false });
      } else {
        setIsEnabled(result.linkPreviewEnabled);
      }
      setIsLoading(false);
    });
    
    // Check AI availability
    chrome.runtime.sendMessage({ type: 'getAIStatus' }, (response) => {
      if (response) {
        setAiStatus({
          summarizer: response.summarizer || 'unavailable',
          languageModel: response.languageModel || 'unavailable',
        });
      }
    });
    
    // Handle download progress
    const handleMessage = (message: any) => {
      if (message.type === 'downloadProgress') {
        if (message.api === 'summarizer') {
          setSummarizerProgress(Math.min(message.progress * 100, 100));
          setAiStatus(prev => ({ ...prev, summarizer: 'downloading' }));
        } else if (message.api === 'languageModel') {
          setLanguageModelProgress(Math.min(message.progress * 100, 100));
          setAiStatus(prev => ({ ...prev, languageModel: 'downloading' }));
        }
      }
    };
    
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const handleToggle = () => {
    const newState = !isEnabled;
    
    // Warn if enabling without AI features
    if (newState && aiStatus.summarizer !== 'available' && aiStatus.languageModel !== 'available') {
      setShowWarning(true);
      return;
    }
    
    applyToggle(newState);
  };
  
  const applyToggle = (newState: boolean) => {
    setIsEnabled(newState);
    setShowWarning(false);
    
    // Save and notify all tabs
    chrome.storage.local.set({ linkPreviewEnabled: newState }, () => {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'togglePreview',
              enabled: newState
            }).catch(() => {
              // Tab might not have content script, that's fine
            });
          }
        });
      });
    });
  };
  
  const handleDownloadSummarizer = () => {
    setSummarizerProgress(0);
    setAiStatus(prev => ({ ...prev, summarizer: 'downloading' }));
    chrome.runtime.sendMessage({ type: 'downloadSummarizer' }, (response) => {
      if (response && response.success) {
        setAiStatus(prev => ({ ...prev, summarizer: response.status }));
        setSummarizerProgress(100);
      } else {
        setAiStatus(prev => ({ ...prev, summarizer: 'unavailable' }));
      }
    });
  };
  
  const handleDownloadLanguageModel = () => {
    setLanguageModelProgress(0);
    setAiStatus(prev => ({ ...prev, languageModel: 'downloading' }));
    chrome.runtime.sendMessage({ type: 'downloadLanguageModel' }, (response) => {
      if (response && response.success) {
        setAiStatus(prev => ({ ...prev, languageModel: response.status }));
        setLanguageModelProgress(100);
      } else {
        setAiStatus(prev => ({ ...prev, languageModel: 'unavailable' }));
      }
    });
  };
  
  const renderAPIStatus = (name: string, status: string, progress: number, onDownload: () => void) => {
    const isAvailable = status === 'available';
    const isDownloadable = status === 'downloadable';
    const isDownloading = status === 'downloading';
    const isUnavailable = status === 'unavailable' || status === 'checking';
    
    return (
      <div className="flex items-center justify-between py-2">
        <span style={{ fontSize: '12px', fontWeight: 600 }}>{name}</span>
        {isAvailable && (
          <span className="px-2.5 py-1 rounded-lg bg-green-500/10 text-green-500" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', border: '1px solid rgba(74, 222, 128, 0.2)' }}>
            ✓ AVAILABLE
          </span>
        )}
        {isDownloadable && (
          <button
            onClick={onDownload}
            className="px-3 py-1.5 rounded-lg bg-accent hover:opacity-90 transition-all text-white"
            style={{ fontSize: '10px', fontWeight: 700, border: 'none', cursor: 'pointer', letterSpacing: '0.05em', boxShadow: '0 2px 8px rgba(124, 158, 255, 0.25)' }}
          >
            DOWNLOAD
          </button>
        )}
        {isDownloading && (
          <div className="flex-1 ml-3">
            <div className="w-full bg-line rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-text-weak" style={{ fontSize: '9px' }}>{Math.round(progress)}%</span>
          </div>
        )}
        {isUnavailable && (
          <span className="px-2 py-1 rounded-full bg-line text-text-weak" style={{ fontSize: '10px', fontWeight: 600 }}>
            {status.toUpperCase()}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="w-80 bg-bg text-text p-6" style={{ minHeight: '200px' }}>
      <div className="p-6" style={{ 
        background: 'var(--surface)', 
        borderRadius: '16px', 
        border: '1px solid var(--line)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, .15), 0 0 0 1px rgba(255, 255, 255, .03) inset'
      }}>
        <div className="flex items-center justify-between mb-4">
          <h1 style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            HoverPeek
          </h1>
          <button
            onClick={handleToggle}
            disabled={isLoading}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all ${
              isEnabled ? 'bg-accent' : 'bg-line'
            } ${isLoading ? 'opacity-50' : ''}`}
            style={{ border: 'none', cursor: isLoading ? 'default' : 'pointer', boxShadow: isEnabled ? '0 0 12px rgba(124, 158, 255, 0.4)' : 'none' }}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-md ${
                isEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-weak)', marginBottom: '16px', lineHeight: '1.5' }}>
          {isEnabled
            ? 'Hover over links for instant previews with AI-powered insights.'
            : 'Enable HoverPeek to see intelligent link previews.'}
        </p>
        
        {showWarning && (
          <div style={{ 
            marginBottom: '16px', 
            padding: '12px', 
            background: 'rgba(255, 165, 2, 0.1)', 
            border: '1px solid rgba(255, 165, 2, 0.3)',
            borderRadius: '8px'
          }}>
            <p style={{ fontSize: '11.5px', color: 'var(--text)', marginBottom: '8px', fontWeight: 500 }}>
              ⚠️ Limited Feature Set
            </p>
            <p style={{ fontSize: '10.5px', color: 'var(--text-weak)', marginBottom: '12px', lineHeight: '1.5' }}>
              AI features are not available. You'll only get basic preflight information (domain, type, risk level) without intelligent summaries.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => applyToggle(true)}
                style={{ 
                  flex: 1,
                  padding: '6px 12px', 
                  background: 'var(--accent)', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '6px', 
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                ENABLE ANYWAY
              </button>
              <button
                onClick={() => setShowWarning(false)}
                style={{ 
                  flex: 1,
                  padding: '6px 12px', 
                  background: 'var(--line)', 
                  color: 'var(--text)', 
                  border: 'none', 
                  borderRadius: '6px', 
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        )}
        
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-weak)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            AI Features
          </h2>
          <div className="space-y-2">
            {renderAPIStatus('Summarizer', aiStatus.summarizer, summarizerProgress, handleDownloadSummarizer)}
            {renderAPIStatus('Language Model', aiStatus.languageModel, languageModelProgress, handleDownloadLanguageModel)}
          </div>
          <p style={{ fontSize: '10px', color: 'var(--text-weak)', marginTop: '12px', lineHeight: '1.4' }}>
            AI features provide intelligent summaries and analysis of webpage content.
          </p>
        </div>
        
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px', marginTop: '16px' }}>
          <h2 style={{ fontSize: '12px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-weak)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Test Website
          </h2>
          <button
            onClick={() => {
              chrome.tabs.create({ url: chrome.runtime.getURL('demo.html') });
            }}
            className="w-full px-4 py-2.5 rounded-lg bg-accent hover:opacity-90 transition-all text-white"
            style={{ fontSize: '11px', fontWeight: 700, border: 'none', cursor: 'pointer', letterSpacing: '0.05em', boxShadow: '0 4px 12px rgba(124, 158, 255, 0.3)' }}
          >
            OPEN DEMO PAGE
          </button>
          <p style={{ fontSize: '10px', color: 'var(--text-weak)', marginTop: '8px', lineHeight: '1.4' }}>
            Test all HoverPeek features with various link types and examples.
          </p>
        </div>
        
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px', marginTop: '16px' }}>
          <h2 style={{ fontSize: '12px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-weak)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Cache Management
          </h2>
          <button
            onClick={() => {
              chrome.runtime.sendMessage({ type: 'clearCache' }, (response) => {
                if (response?.success) {
                  setCacheCleared(true);
                  setTimeout(() => setCacheCleared(false), 3000);
                }
              });
            }}
            className="w-full px-4 py-2.5 rounded-lg hover:opacity-90 transition-all"
            style={{ fontSize: '11px', fontWeight: 700, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--bg)', color: 'var(--text)', letterSpacing: '0.05em' }}
          >
            CLEAR CACHE
          </button>
          {cacheCleared ? (
            <p style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '8px', lineHeight: '1.4', fontWeight: 600 }}>
              ✓ Cache cleared successfully
            </p>
          ) : (
            <p style={{ fontSize: '10px', color: 'var(--text-weak)', marginTop: '8px', lineHeight: '1.4' }}>
              Clear all cached preview data to free up storage space.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

