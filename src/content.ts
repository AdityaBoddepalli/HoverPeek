import './content.css';

enum LinkType {
  Webpage = 'webpage',
  PDF = 'pdf',
  Download = 'download',
  Image = 'image',
  Video = 'video',
  Mailto = 'mailto',
  Tel = 'tel',
  Anchor = 'anchor',
  Blocked = 'blocked',
}

enum RiskLevel {
  Green = 'green',
  Amber = 'amber',
  Red = 'red',
}

interface VideoPlatform {
  platform: 'youtube' | 'vimeo' | 'dailymotion' | 'tiktok' | 'twitch' | 'video-file' | 'unknown';
  videoId?: string;
  embedUrl?: string;
}

interface PreflightResult {
  domain: string;
  type: LinkType;
  risk: RiskLevel;
  reasons: string[];
  size?: number;
  finalUrl: string;
  fetchPlan: string;
  redirectCount?: number;
  textMismatch?: { textDomain: string; linkDomain: string };
  videoPlatform?: VideoPlatform;
}

interface LinkState {
  element: HTMLAnchorElement;
  previewElement: HTMLElement | null;
  preflightResult: PreflightResult | null;
  hoverTimeout?: number;
}

const activeLinks = new Map<HTMLAnchorElement, LinkState>();
const hoverTimeouts = new Map<HTMLAnchorElement, number>();
let isExtensionEnabled = true;

chrome.storage.local.get(['linkPreviewEnabled'], (result) => {
  isExtensionEnabled = result.linkPreviewEnabled !== false;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'togglePreview') {
    isExtensionEnabled = message.enabled;
    
    if (!isExtensionEnabled) {
      activeLinks.forEach((_, link) => cleanup(link));
    }
  }
});


function createPreviewPopup(result: PreflightResult): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'link-preview-popup';
  popup.style.cssText = `
    position: absolute;
    background: var(--surface);

    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 16px;
    max-width: 340px;
    max-height: 500px;
    overflow: visible;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .4), 
                0 0 0 1px rgba(255, 255, 255, .03) inset;
    z-index: 10000;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: var(--text);
    transition: height 0.2s ease-out;
    backdrop-filter: blur(20px);
  `;
  
  const aurora = document.createElement('div');
  const auroraColor = result.risk === RiskLevel.Red 
    ? 'rgba(255, 71, 87, 0.6)' 
    : result.risk === RiskLevel.Amber 
    ? 'rgba(255, 165, 2, 0.6)' 
    : 'rgba(124, 158, 255, 0.6)';
  aurora.style.cssText = `
    position: absolute;
    top: -1px;
    left: -1px;
    right: -1px;
    height: 3px;
    background: linear-gradient(90deg, ${auroraColor} 0%, ${auroraColor} 50%, transparent 100%);
    border-radius: 16px 16px 0 0;
    pointer-events: none;
  `;
  popup.appendChild(aurora);
  
  const domainContainer = document.createElement('div');
  domainContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
    padding-top: 2px;
  `;
  
  const favicon = document.createElement('img');
  favicon.src = `https://www.google.com/s2/favicons?domain=${result.domain}&sz=32`;
  favicon.style.cssText = `
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border-radius: 4px;
  `;
  favicon.onerror = () => {
    favicon.style.display = 'none';
  };
  domainContainer.appendChild(favicon);
  
  const domainText = document.createElement('div');
  domainText.textContent = result.domain;
  domainText.style.cssText = `
    font-weight: 600;
    font-size: 14px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.01em;
  `;
  domainContainer.appendChild(domainText);
  popup.appendChild(domainContainer);
  
  const chipsRow = document.createElement('div');
  chipsRow.className = 'chips-row';
  chipsRow.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  `;
  
  const typeChip = document.createElement('span');
  typeChip.className = 'type-chip';
  typeChip.textContent = getTypeLabel(result.type);
  typeChip.setAttribute('data-type', result.type);
  chipsRow.appendChild(typeChip);
  
  const riskBadge = document.createElement('span');
  riskBadge.className = 'risk-badge';
  riskBadge.setAttribute('data-risk', result.risk);
  riskBadge.textContent = result.risk === RiskLevel.Green 
    ? '✓ Safe' 
    : result.risk === RiskLevel.Amber 
    ? '⚠ Caution' 
    : '✕ Unsafe';
  chipsRow.appendChild(riskBadge);
  
  popup.appendChild(chipsRow);
  
  // Show warning if anchor text doesn't match link domain
  if (result.textMismatch) {
    const mismatchWarning = document.createElement('div');
    mismatchWarning.style.cssText = `
      font-size: 11px;
      color: var(--text-weak);
      margin-top: 8px;
      padding: 6px 10px;
      background: rgba(251, 191, 36, 0.1);
      border-left: 2px solid #fbbf24;
      border-radius: 4px;
    `;
    mismatchWarning.textContent = `Text says "${result.textMismatch.textDomain}" but link is for "${result.textMismatch.linkDomain}"`;
    popup.appendChild(mismatchWarning);
  }
  
  // Show email address for mailto links
  if (result.type === LinkType.Mailto) {
    try {
      // Parse mailto: URL to get the email
      const mailtoUrl = result.finalUrl;
      const emailMatch = mailtoUrl.match(/^mailto:([^?]+)/i);
      if (emailMatch && emailMatch[1]) {
        const emailAddress = decodeURIComponent(emailMatch[1]);
        const emailText = document.createElement('div');
        emailText.textContent = `To: ${emailAddress}`;
        emailText.style.cssText = `
          font-size: 11.5px;
          color: var(--text-weak);
          margin-top: 6px;
          margin-bottom: 4px;
        `;
        popup.appendChild(emailText);
      }
    } catch (e) {
      // Skip if URL parsing fails
    }
  }
  
  // Show anchor destination for same-page links
  if (result.type === LinkType.Anchor) {
    try {
      const url = new URL(result.finalUrl);
      if (url.hash) {
        const anchorName = url.hash.substring(1); // Strip the #
        const anchorText = document.createElement('div');
        anchorText.textContent = `This is an anchor to "${anchorName}" in the same page`;
        anchorText.style.cssText = `
          font-size: 11.5px;
          color: var(--text-weak);
          margin-top: 6px;
          margin-bottom: 4px;
        `;
        popup.appendChild(anchorText);
      }
    } catch (e) {
      // Skip if URL parsing fails
    }
  }
  
  // Show phone number for tel links
  if (result.type === LinkType.Tel) {
    try {
      // Parse tel: URL
      const telUrl = result.finalUrl;
      const phoneMatch = telUrl.match(/^tel:(.+)$/i);
      if (phoneMatch && phoneMatch[1]) {
        const phoneNumber = decodeURIComponent(phoneMatch[1]);
        const phoneText = document.createElement('div');
        phoneText.textContent = `Call: ${phoneNumber}`;
        phoneText.style.cssText = `
          font-size: 11.5px;
          color: var(--text-weak);
          margin-top: 6px;
          margin-bottom: 4px;
        `;
        popup.appendChild(phoneText);
      }
    } catch (e) {
      // Skip if URL parsing fails
    }
  }
  
  // Show video platform details
  if (result.type === LinkType.Video && result.videoPlatform) {
    const videoContainer = document.createElement('div');
    videoContainer.className = 'preview-video';
    videoContainer.style.cssText = `
      margin-top: 8px;
      padding: 10px 12px;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 8px;
    `;
    
    const platformInfo = document.createElement('div');
    platformInfo.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    `;
    
    // Platform icon
    const platformIcon = document.createElement('span');
    platformIcon.style.cssText = `font-size: 14px;`;
    const platformName = document.createElement('span');
    platformName.style.cssText = `
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-weak);
    `;
    
    switch (result.videoPlatform.platform) {
      case 'youtube':
        platformIcon.textContent = '▶️';
        platformName.textContent = 'YouTube';
        break;
      case 'vimeo':
        platformIcon.textContent = '🎬';
        platformName.textContent = 'Vimeo';
        break;
      case 'dailymotion':
        platformIcon.textContent = '📺';
        platformName.textContent = 'Dailymotion';
        break;
      case 'tiktok':
        platformIcon.textContent = '🎵';
        platformName.textContent = 'TikTok';
        break;
      case 'twitch':
        platformIcon.textContent = '🎮';
        platformName.textContent = 'Twitch';
        break;
      case 'video-file':
        platformIcon.textContent = '🎞️';
        platformName.textContent = 'Video File';
        break;
      default:
        platformIcon.textContent = '🎥';
        platformName.textContent = 'Video';
    }
    
    platformInfo.appendChild(platformIcon);
    platformInfo.appendChild(platformName);
    videoContainer.appendChild(platformInfo);
    
    // Show video ID if we have it
    if (result.videoPlatform.videoId && result.videoPlatform.platform !== 'video-file') {
      const videoIdText = document.createElement('div');
      videoIdText.style.cssText = `
        font-size: 10px;
        color: var(--text-weak);
        font-family: monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      videoIdText.textContent = `ID: ${result.videoPlatform.videoId}`;
      videoContainer.appendChild(videoIdText);
    }
    
    popup.appendChild(videoContainer);
  } else if (result.type === LinkType.Video) {
    // Fallback when we can't detect the platform
    const videoText = document.createElement('div');
    videoText.textContent = 'Video file';
    videoText.style.cssText = `
      font-size: 11.5px;
      color: var(--text-weak);
      margin-top: 6px;
      margin-bottom: 4px;
    `;
    popup.appendChild(videoText);
  }
  
  // Show file size if we know it
  if (result.size) {
    const sizeText = document.createElement('div');
    sizeText.textContent = formatSize(result.size);
    sizeText.style.cssText = `
      font-size: 11.5px;
      color: var(--text-weak);
      margin-bottom: 4px;
    `;
    popup.appendChild(sizeText);
  }
  
  // Show risk reasons
  if (result.reasons.length > 0) {
    const reasonsText = document.createElement('div');
    reasonsText.textContent = `Why: ${result.reasons.join(', ')}`;
    reasonsText.style.cssText = `
      font-size: 11.5px;
      color: var(--text-weak);
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--line);
    `;
    popup.appendChild(reasonsText);
  }
  
  return popup;
}

function getTypeLabel(type: LinkType): string {
  const labels: Record<LinkType, string> = {
    [LinkType.Webpage]: '🌐 Webpage',
    [LinkType.PDF]: '📄 PDF',
    [LinkType.Download]: '⬇️ Download',
    [LinkType.Image]: '🖼️ Image',
    [LinkType.Video]: '🎬 Video',
    [LinkType.Mailto]: '✉️ Email',
    [LinkType.Tel]: '📞 Phone',
    [LinkType.Anchor]: '🔗 Anchor',
    [LinkType.Blocked]: '🚫 Blocked',
  };
  return labels[type] || '🔗 Link';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createLoadingPopup(domain: string): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'link-preview-popup loading';
  popup.style.cssText = `
    position: absolute;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 16px;
    max-width: 340px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .4), 
                0 0 0 1px rgba(255, 255, 255, .03) inset;
    z-index: 10000;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: var(--text);
    backdrop-filter: blur(20px);
  `;
  
  // Top border glow
  const aurora = document.createElement('div');
  aurora.style.cssText = `
    position: absolute;
    top: -1px;
    left: -1px;
    right: -1px;
    height: 3px;
    background: linear-gradient(90deg, rgba(124, 158, 255, 0.6) 0%, rgba(124, 158, 255, 0.6) 50%, transparent 100%);
    border-radius: 16px 16px 0 0;
  `;
  popup.appendChild(aurora);
  
  // Small spacer
  const spacer = document.createElement('div');
  spacer.style.cssText = 'height: 2px;';
  popup.appendChild(spacer);
  
  // Loading skeleton for domain
  const domainSkeleton = document.createElement('div');
  domainSkeleton.className = 'skeleton-line';
  domainSkeleton.style.cssText = `
    height: 18px;
    width: 65%;
    background: var(--line);
    border-radius: 6px;
    margin-bottom: 10px;
  `;
  popup.appendChild(domainSkeleton);
  
  // Loading skeleton for chips
  const chipsRow = document.createElement('div');
  chipsRow.style.cssText = 'display: flex; gap: 8px; margin-bottom: 10px;';
  
  const chipSkeleton1 = document.createElement('div');
  chipSkeleton1.className = 'skeleton-line';
  chipSkeleton1.style.cssText = `
    height: 24px;
    width: 80px;
    background: var(--line);
    border-radius: 8px;
  `;
  
  const chipSkeleton2 = document.createElement('div');
  chipSkeleton2.className = 'skeleton-line';
  chipSkeleton2.style.cssText = `
    height: 24px;
    width: 60px;
    background: var(--line);
    border-radius: 8px;
  `;
  
  chipsRow.appendChild(chipSkeleton1);
  chipsRow.appendChild(chipSkeleton2);
  popup.appendChild(chipsRow);
  
  // Loading skeleton lines
  for (let i = 0; i < 2; i++) {
    const line = document.createElement('div');
    line.className = 'skeleton-line';
    line.style.cssText = `
      height: 14px;
      width: ${i === 0 ? '92%' : '75%'};
      background: var(--line);
      border-radius: 6px;
      margin-bottom: 8px;
    `;
    popup.appendChild(line);
  }
  
  return popup;
}


function positionPreview(link: HTMLAnchorElement, preview: HTMLElement): void {
  const rect = link.getBoundingClientRect();
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Rough size estimates (we'll adjust after render)
  const previewWidth = 320;
  const previewHeight = preview.offsetHeight || 200;
  
  const padding = 8; // Keep away from edges
  const gap = 8; // Space between link and preview
  
  // How much room do we have in each direction?
  const spaceRight = viewportWidth - rect.right - padding;
  const spaceLeft = rect.left - padding;
  const spaceBelow = viewportHeight - rect.bottom - padding;
  const spaceAbove = rect.top - padding;
  
  // Try each position and score them
  const positions = [
    {
      name: 'right',
      score: Math.min(spaceRight, previewWidth),
      canFit: spaceRight >= previewWidth,
      x: rect.right + gap + scrollX,
      y: rect.top + scrollY,
      transform: '',
    },
    {
      name: 'left',
      score: Math.min(spaceLeft, previewWidth),
      canFit: spaceLeft >= previewWidth,
      x: rect.left - gap - previewWidth + scrollX,
      y: rect.top + scrollY,
      transform: '',
    },
    {
      name: 'below',
      score: Math.min(spaceBelow, previewHeight),
      canFit: spaceBelow >= previewHeight,
      x: rect.left + scrollX,
      y: rect.bottom + gap + scrollY,
      transform: '',
    },
    {
      name: 'above',
      score: Math.min(spaceAbove, previewHeight),
      canFit: spaceAbove >= previewHeight,
      x: rect.left + scrollX,
      y: rect.top - gap + scrollY,
      transform: 'translateY(-100%)',
    },
  ];
  
  // Pick the best position (prefer ones that fit completely)
  positions.sort((a, b) => {
    if (a.canFit && !b.canFit) return -1;
    if (!a.canFit && b.canFit) return 1;
    return b.score - a.score;
  });
  
  const bestPosition = positions[0];
  
  // Set initial position
  preview.style.left = `${bestPosition.x}px`;
  preview.style.top = `${bestPosition.y}px`;
  preview.style.transform = bestPosition.transform;
  
  // Make sure it doesn't go off screen
  requestAnimationFrame(() => {
    const previewRect = preview.getBoundingClientRect();
    
    let adjustX = 0;
    let adjustY = 0;
    
    // Keep it on screen
    if (previewRect.right > viewportWidth - padding) {
      adjustX = viewportWidth - padding - previewRect.right;
    }
    if (previewRect.left < padding) {
      adjustX = padding - previewRect.left;
    }
    if (previewRect.bottom > viewportHeight - padding) {
      adjustY = viewportHeight - padding - previewRect.bottom;
    }
    if (previewRect.top < padding) {
      adjustY = padding - previewRect.top;
    }
    
    if (adjustX !== 0 || adjustY !== 0) {
      preview.style.left = `${bestPosition.x + adjustX}px`;
      preview.style.top = `${bestPosition.y + adjustY}px`;
    }
  });
}

function repositionPreview(link: HTMLAnchorElement, preview: HTMLElement): void {
  // Wait for DOM to update, then reposition
  requestAnimationFrame(() => {
    const previewRect = preview.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 8;
    
    // Current position
    const currentLeft = parseFloat(preview.style.left) || 0;
    const currentTop = parseFloat(preview.style.top) || 0;
    
    let adjustX = 0;
    let adjustY = 0;
    
    // Nudge it back on screen if needed
    if (previewRect.right > viewportWidth - padding) {
      adjustX = viewportWidth - padding - previewRect.right;
    }
    if (previewRect.left < padding) {
      adjustX = padding - previewRect.left;
    }
    if (previewRect.bottom > viewportHeight - padding) {
      adjustY = viewportHeight - padding - previewRect.bottom;
    }
    if (previewRect.top < padding) {
      adjustY = padding - previewRect.top;
    }
    
    // Update position
    if (adjustX !== 0 || adjustY !== 0) {
      preview.style.left = `${currentLeft + adjustX}px`;
      preview.style.top = `${currentTop + adjustY}px`;
    }
  });
}


function handleLinkHover(link: HTMLAnchorElement, url: string): void {
  if (!isExtensionEnabled) {
    return;
  }
  
  if (activeLinks.has(link)) {
    return; // Already processing this one
  }
  
  const state: LinkState = {
    element: link,
    previewElement: null,
    preflightResult: null,
  };
  
  activeLinks.set(link, state);
  
  // Check the link (shows preview when ready, no loading spinner)
  chrome.runtime.sendMessage(
    { 
      type: 'preflightCheck', 
      href: url,
      anchorText: link.textContent?.trim() || '',
      pageOrigin: window.location.href,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error in preflight check:', chrome.runtime.lastError);
        cleanup(link);
        return;
      }
      
      const currentState = activeLinks.get(link);
      if (!currentState) return;
      
      if (response && response.success && response.result) {
        currentState.preflightResult = response.result;
        
        // Clean up any existing preview
        if (currentState.previewElement && currentState.previewElement.parentNode) {
          currentState.previewElement.parentNode.removeChild(currentState.previewElement);
        }
        
        // Show the preview popup
        const preview = createPreviewPopup(response.result);
        document.body.appendChild(preview);
        positionPreview(link, preview);
        
        currentState.previewElement = preview;
        
        // Request AI preview if this link type supports it
        const result = response.result;
        const shouldRequestPreview = 
          ((result.type === LinkType.Webpage || result.type === LinkType.PDF || result.type === LinkType.Image) && 
          result.fetchPlan === 'partial-get' ||
          result.type === LinkType.Download && result.fetchPlan === 'head-only') &&
          (result.risk === RiskLevel.Green || result.risk === RiskLevel.Amber);
        
        if (shouldRequestPreview) {
          // Show loading spinner for whatever we're fetching
          if (result.type === LinkType.PDF) {
            addOutlineLoading(preview);
            addSummaryLoading(preview);
          } else if (result.type === LinkType.Webpage) {
            addOverviewLoading(preview);
          } else if (result.type === LinkType.Image) {
            addImageDescriptionLoading(preview);
          } else if (result.type === LinkType.Download) {
            addOverviewLoading(preview);
          } else {
            addLoadingState(preview);
          }
          
          chrome.runtime.sendMessage({
            type: 'generatePreview',
            preflightResult: result,
          });
        }
      } else {
        cleanup(link);
      }
    }
  );
}

function cleanup(link: HTMLAnchorElement): void {
  // Clear any pending hover timeout
  const timeoutId = hoverTimeouts.get(link);
  if (timeoutId) {
    clearTimeout(timeoutId);
    hoverTimeouts.delete(link);
  }
  
  const state = activeLinks.get(link);
  if (!state) return;
  
  if (state.previewElement && state.previewElement.parentNode) {
    state.previewElement.parentNode.removeChild(state.previewElement);
  }
  
  activeLinks.delete(link);
}

function handleLinkMouseOver(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const link = target.closest('a') as HTMLAnchorElement;
  
  if (!link || !link.href) return;
  
  // Skip if we're already handling this link
  if (activeLinks.has(link) || hoverTimeouts.has(link)) return;
  
  // Wait 300ms before showing preview (avoid showing on accidental hovers)
  const timeoutId = window.setTimeout(() => {
    hoverTimeouts.delete(link);
    handleLinkHover(link, link.href);
  }, 300);
  
  hoverTimeouts.set(link, timeoutId);
}

function handleLinkMouseOut(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const link = target.closest('a') as HTMLAnchorElement;
  
  if (!link) return;
  
  // Don't hide if mouse moved to a child element
  const relatedTarget = event.relatedTarget as HTMLElement;
  if (relatedTarget && link.contains(relatedTarget)) {
    return;
  }
  
  cleanup(link);
}

function handleLinkClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const link = target.closest('a') as HTMLAnchorElement;
  
  if (!link) return;
  
  // Check if this link has a red risk level and block it
  const state = activeLinks.get(link);
  if (state?.preflightResult?.risk === RiskLevel.Red) {
    event.preventDefault();
    event.stopPropagation();
    
    // Add visual feedback that the link is blocked
    if (state.previewElement) {
      const preview = state.previewElement;
      preview.style.animation = 'shake 0.5s ease-in-out';
      
      // Add a blocking message if not already present
      const existingBlockMsg = preview.querySelector('.blocked-message');
      if (!existingBlockMsg) {
        const blockMsg = document.createElement('div');
        blockMsg.className = 'blocked-message';
        blockMsg.textContent = '🚫 This link is blocked for your safety';
        blockMsg.style.cssText = `
          background: rgba(255, 71, 87, 0.15);
          color: #ff4757;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          text-align: center;
          margin-top: 8px;
          border: 1px solid rgba(255, 71, 87, 0.3);
        `;
        preview.appendChild(blockMsg);
        
        // Remove the message after 2 seconds
        setTimeout(() => {
          if (blockMsg.parentNode) {
            blockMsg.remove();
          }
        }, 2000);
      }
    }
    
    return;
  }
  
  // Hide preview on click for safe links
  cleanup(link);
}

// Handle preview updates from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'previewUpdate') {
    updatePreviewWithAIContent(message.update);
  }
});

function updatePreviewWithAIContent(update: any): void {
  // Find which preview to update
  for (const [link, state] of activeLinks.entries()) {
    if (state.previewElement && state.preflightResult) {
      const preview = state.previewElement;
      
      if (update.aiAvailable === false) {
        addAIUnavailableMessage(preview, update.reason || 'AI features not available');
        return;
      }
      
      if (update.clearLoading) {
        // Remove all loading spinners
        removeLoadingState(preview);
        removeOutlineLoading(preview);
        removeSummaryLoading(preview);
        removeOverviewLoading(preview);
        removeImageDescriptionLoading(preview);
        return;
      }
      
      if (update.cached) {
        addCachedBadge(preview);
      }
      
      if (update.overview) {
        updateOverview(preview, update.overview);
        repositionPreview(link, preview);
      }
      
      if (update.summary && state.preflightResult?.type === LinkType.PDF) {
        updateSummary(preview, update.summary);
        repositionPreview(link, preview);
      }
      
      if (update.outline && update.outline.length > 0) {
        updateOutline(preview, update.outline);
        repositionPreview(link, preview);
      }
      
      if (update.imageUrl) {
        addImageThumbnail(preview, update.imageUrl);
        repositionPreview(link, preview);
      }
      
      if (update.imageDescription) {
        updateImageDescription(preview, update.imageDescription);
        repositionPreview(link, preview);
      }
      
      if (update.riskNote) {
        updateRiskNote(preview, update.riskNote);
        repositionPreview(link, preview);
      }
      
      if (update.error && state.preflightResult?.type === LinkType.PDF) {
        updateSummary(preview, update.error);
      }
      
      break; // Only update the first match
    }
  }
}

function addLoadingState(preview: HTMLElement): void {
  if (preview.querySelector('.preview-loading')) {
    return;
  }
  
  const loadingEl = document.createElement('div');
  loadingEl.className = 'preview-loading';
  
  const spinner = document.createElement('div');
  spinner.className = 'preview-loading-spinner';
  
  const text = document.createElement('span');
  text.textContent = 'Loading';
  
  loadingEl.appendChild(spinner);
  loadingEl.appendChild(text);
  preview.appendChild(loadingEl);
}

function removeLoadingState(preview: HTMLElement): void {
  const loadingEl = preview.querySelector('.preview-loading');
  if (loadingEl) {
    loadingEl.remove();
  }
}

function addOutlineLoading(preview: HTMLElement): void {
  if (preview.querySelector('.outline-loading')) {
    return;
  }
  
  const loadingEl = document.createElement('div');
  loadingEl.className = 'preview-loading outline-loading';
  
  const spinner = document.createElement('div');
  spinner.className = 'preview-loading-spinner';
  
  const text = document.createElement('span');
  text.textContent = 'Loading outline';
  
  loadingEl.appendChild(spinner);
  loadingEl.appendChild(text);
  preview.appendChild(loadingEl);
}

function removeOutlineLoading(preview: HTMLElement): void {
  const loadingEl = preview.querySelector('.outline-loading');
  if (loadingEl) {
    loadingEl.remove();
  }
}

function addSummaryLoading(preview: HTMLElement): void {
  if (preview.querySelector('.summary-loading')) {
    return;
  }
  
  const loadingEl = document.createElement('div');
  loadingEl.className = 'preview-loading summary-loading';
  
  const spinner = document.createElement('div');
  spinner.className = 'preview-loading-spinner';
  
  const text = document.createElement('span');
  text.textContent = 'Loading summary';
  
  loadingEl.appendChild(spinner);
  loadingEl.appendChild(text);
  preview.appendChild(loadingEl);
}

function removeSummaryLoading(preview: HTMLElement): void {
  const loadingEl = preview.querySelector('.summary-loading');
  if (loadingEl) {
    loadingEl.remove();
  }
}

function addOverviewLoading(preview: HTMLElement): void {
  if (preview.querySelector('.overview-loading')) {
    return;
  }
  
  const loadingEl = document.createElement('div');
  loadingEl.className = 'preview-loading overview-loading';
  
  const spinner = document.createElement('div');
  spinner.className = 'preview-loading-spinner';
  
  const text = document.createElement('span');
  text.textContent = 'Loading AI overview';
  
  loadingEl.appendChild(spinner);
  loadingEl.appendChild(text);
  preview.appendChild(loadingEl);
}

function removeOverviewLoading(preview: HTMLElement): void {
  const loadingEl = preview.querySelector('.overview-loading');
  if (loadingEl) {
    loadingEl.remove();
  }
}

function addImageDescriptionLoading(preview: HTMLElement): void {
  if (preview.querySelector('.image-description-loading')) {
    return;
  }
  
  const loadingEl = document.createElement('div');
  loadingEl.className = 'preview-loading image-description-loading';
  
  const spinner = document.createElement('div');
  spinner.className = 'preview-loading-spinner';
  
  const text = document.createElement('span');
  text.textContent = 'Analyzing image';
  
  loadingEl.appendChild(spinner);
  loadingEl.appendChild(text);
  preview.appendChild(loadingEl);
}

function removeImageDescriptionLoading(preview: HTMLElement): void {
  const loadingEl = preview.querySelector('.image-description-loading');
  if (loadingEl) {
    loadingEl.remove();
  }
}

function addCachedBadge(preview: HTMLElement): void {
  if (preview.querySelector('.cached-badge')) {
    return;
  }
  
  const chipsRow = preview.querySelector('.chips-row');
  if (!chipsRow) return;
  
  const cachedBadge = document.createElement('span');
  cachedBadge.className = 'cached-badge';
  cachedBadge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
    background: rgba(124, 158, 255, 0.15);
    border: 1px solid rgba(124, 158, 255, 0.3);
    color: var(--accent);
  `;
  cachedBadge.textContent = '⚡ Cached';
  
  chipsRow.appendChild(cachedBadge);
}

function addAIUnavailableMessage(preview: HTMLElement, reason: string): void {
  const existing = preview.querySelector('.ai-unavailable');
  if (existing) return;
  
  // Clear loading spinners
  removeLoadingState(preview);
  removeOutlineLoading(preview);
  removeSummaryLoading(preview);
  removeOverviewLoading(preview);
  removeImageDescriptionLoading(preview);
  
  const message = document.createElement('div');
  message.className = 'ai-unavailable';
  message.style.cssText = `
    margin-top: 8px;
    padding: 6px 10px;
    background: rgba(255, 165, 0, 0.1);
    border-left: 2px solid #ffa502;
    border-radius: 4px;
    font-size: 11px;
    color: var(--text-weak);
  `;
  message.textContent = reason;
  preview.appendChild(message);
}

function updateSummary(preview: HTMLElement, summary: string): void {
  removeLoadingState(preview);
  removeSummaryLoading(preview);
  
  let summaryEl = preview.querySelector('.preview-summary') as HTMLElement;
  
  if (!summaryEl) {
    summaryEl = document.createElement('div');
    summaryEl.className = 'preview-summary';
    summaryEl.style.cssText = `
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--line);
      font-size: 12px;
      line-height: 1.6;
      color: var(--text);
      white-space: normal;
      word-wrap: break-word;
      overflow-wrap: break-word;
      max-width: 100%;
    `;
    preview.appendChild(summaryEl);
  }
  
  summaryEl.textContent = summary;
}

function updateOverview(preview: HTMLElement, overview: string): void {
  removeOverviewLoading(preview);
  
  let overviewEl = preview.querySelector('.preview-overview') as HTMLElement;
  
  if (!overviewEl) {
    overviewEl = document.createElement('div');
    overviewEl.className = 'preview-overview';
    overviewEl.style.cssText = `
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--line);
      font-size: 11.5px;
      line-height: 1.6;
      color: var(--text);
    `;
    
    const title = document.createElement('div');
    title.style.cssText = `
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--text-weak);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.5px;
    `;
    title.textContent = 'AI Overview';
    overviewEl.appendChild(title);
    
    preview.appendChild(overviewEl);
  }
  
  let contentEl = overviewEl.querySelector('.overview-content') as HTMLElement;
  if (!contentEl) {
    contentEl = document.createElement('div');
    contentEl.className = 'overview-content';
    contentEl.style.cssText = `
      color: var(--text);
      white-space: normal;
      word-wrap: break-word;
      overflow-wrap: break-word;
    `;
    overviewEl.appendChild(contentEl);
  }
  
  contentEl.textContent = overview;
}

function updateOutline(preview: HTMLElement, outline: string[]): void {
  removeOutlineLoading(preview);
  
  let outlineEl = preview.querySelector('.preview-outline') as HTMLElement;
  
  if (!outlineEl) {
    outlineEl = document.createElement('div');
    outlineEl.className = 'preview-outline';
    outlineEl.style.cssText = `
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--line);
      font-size: 11.5px;
      line-height: 1.6;
      color: var(--text);
    `;
    
    const title = document.createElement('div');
    title.style.cssText = `
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--text-weak);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.5px;
    `;
    title.textContent = 'Outline';
    outlineEl.appendChild(title);
    
    preview.appendChild(outlineEl);
  }
  
  // Replace existing items
  const title = outlineEl.querySelector('div');
  outlineEl.innerHTML = '';
  if (title) outlineEl.appendChild(title);
  
  outline.forEach((item) => {
    const itemEl = document.createElement('div');
    itemEl.style.cssText = `
      margin: 2px 0;
      padding-left: 10px;
      position: relative;
    `;
    itemEl.textContent = `• ${item}`;
    outlineEl.appendChild(itemEl);
  });
}

function addImageThumbnail(preview: HTMLElement, imageUrl: string): void {
  if (preview.querySelector('.preview-image-thumbnail')) {
    return;
  }

  const thumbnailContainer = document.createElement('div');
  thumbnailContainer.className = 'preview-image-thumbnail';
  thumbnailContainer.style.cssText = `
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
    display: flex;
    justify-content: center;
    align-items: center;
    background: var(--bg);
    border-radius: 8px;
    overflow: hidden;
    max-height: 200px;
  `;

  const img = document.createElement('img');
  img.src = imageUrl;
  img.style.cssText = `
    max-width: 100%;
    max-height: 200px;
    object-fit: contain;
    border-radius: 6px;
    display: block;
  `;
  
  img.onerror = () => {
    thumbnailContainer.remove();
  };

  thumbnailContainer.appendChild(img);
  
  // Put thumbnail before description if it exists
  const descriptionEl = preview.querySelector('.preview-image-description');
  if (descriptionEl) {
    preview.insertBefore(thumbnailContainer, descriptionEl);
  } else {
    preview.appendChild(thumbnailContainer);
  }
}

function updateImageDescription(preview: HTMLElement, description: string): void {
  removeImageDescriptionLoading(preview);
  
  let descriptionEl = preview.querySelector('.preview-image-description') as HTMLElement;
  
  if (!descriptionEl) {
    descriptionEl = document.createElement('div');
    descriptionEl.className = 'preview-image-description';
    descriptionEl.style.cssText = `
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--line);
      font-size: 11.5px;
      line-height: 1.6;
      color: var(--text);
    `;
    
    const title = document.createElement('div');
    title.style.cssText = `
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--text-weak);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.5px;
    `;
    title.textContent = 'Image Description';
    descriptionEl.appendChild(title);
    
    preview.appendChild(descriptionEl);
  }
  
  let contentEl = descriptionEl.querySelector('.image-description-content') as HTMLElement;
  if (!contentEl) {
    contentEl = document.createElement('div');
    contentEl.className = 'image-description-content';
    contentEl.style.cssText = `
      color: var(--text);
      white-space: normal;
      word-wrap: break-word;
      overflow-wrap: break-word;
    `;
    descriptionEl.appendChild(contentEl);
  }
  
  contentEl.textContent = description;
}

function updateRiskNote(preview: HTMLElement, riskNote: string): void {
  removeLoadingState(preview);
  
  let noteEl = preview.querySelector('.preview-risk-note') as HTMLElement;
  
  if (!noteEl) {
    noteEl = document.createElement('div');
    noteEl.className = 'preview-risk-note';
    noteEl.style.cssText = `
      margin-top: 8px;
      padding: 8px 10px;
      background: rgba(255, 165, 0, 0.1);
      border-left: 2px solid #ffa502;
      border-radius: 4px;
      font-size: 11.5px;
      line-height: 1.5;
      color: var(--text);
    `;
    
    const title = document.createElement('div');
    title.style.cssText = `
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--text-weak);
      text-transform: uppercase;
      font-size: 9.5px;
      letter-spacing: 0.5px;
    `;
    title.textContent = 'Risk Note';
    noteEl.appendChild(title);
    
    preview.appendChild(noteEl);
  }
  
  const note = document.createElement('div');
  note.textContent = riskNote;
  noteEl.appendChild(note);
}

// Set up event listeners
document.addEventListener('mouseover', handleLinkMouseOver, true);
document.addEventListener('mouseout', handleLinkMouseOut, true);
document.addEventListener('click', handleLinkClick, true);

// Clean up when page unloads
window.addEventListener('beforeunload', () => {
  activeLinks.forEach((_, link) => cleanup(link));
});

// Hide previews when tab becomes hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    activeLinks.forEach((_, link) => cleanup(link));
  }
});

