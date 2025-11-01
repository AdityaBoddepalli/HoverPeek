declare const Summarizer: any;
declare const LanguageModel: any;

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

enum FetchPlan {
  Blocked = 'blocked',
  HeadOnly = 'head-only',
  PartialGet = 'partial-get',
  NoFetch = 'no-fetch',
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
  fetchPlan: FetchPlan;
  redirectCount?: number;
  textMismatch?: { textDomain: string; linkDomain: string };
  videoPlatform?: VideoPlatform;
}

interface RiskSignal {
  level: RiskLevel;
  reason: string;
}

const CACHE_DURATION = 5 * 60 * 1000;

class CacheManager<T> {
  private memoryCache = new Map<string, { data: T; timestamp: number }>();
  private storageKey: string;
  private isInitialized = false;

  constructor(storageKey: string) {
    this.storageKey = storageKey;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      if (result[this.storageKey]) {
        const stored = result[this.storageKey] as Record<string, { data: T; timestamp: number }>;
        const now = Date.now();
        for (const [key, entry] of Object.entries(stored)) {
          if (now - entry.timestamp < CACHE_DURATION) {
            this.memoryCache.set(key, entry);
          }
        }
      }
      this.isInitialized = true;
    } catch (error) {
      console.error('[Cache] Failed to initialize cache:', error);
      this.isInitialized = true;
    }
  }

  async get(key: string): Promise<{ data: T; timestamp: number } | null> {
    const cached = this.memoryCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached;
    }
    if (cached) {
      this.memoryCache.delete(key);
    }
    return null;
  }

  async set(key: string, data: T): Promise<void> {
    const entry = { data, timestamp: Date.now() };
    this.memoryCache.set(key, entry);
    
    this.persistToStorage().catch(error => {
      console.error('[Cache] Failed to persist cache:', error);
    });
  }

  private async persistToStorage(): Promise<void> {
    if (!this.isInitialized) return;
    
    const toStore: Record<string, { data: T; timestamp: number }> = {};
    const now = Date.now();
    
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now - entry.timestamp < CACHE_DURATION) {
        toStore[key] = entry;
      }
    }
    
    try {
      await chrome.storage.local.set({ [this.storageKey]: toStore });
    } catch (error) {
      await this.cleanup();
    }
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now - entry.timestamp >= CACHE_DURATION) {
        this.memoryCache.delete(key);
      }
    }
    await this.persistToStorage();
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    try {
      await chrome.storage.local.remove(this.storageKey);
    } catch (error) {
      console.error('[Cache] Failed to clear cache:', error);
    }
  }
}

const titleCache = new CacheManager<string>('hoverpeek_title_cache');
const preflightCache = new CacheManager<PreflightResult>('hoverpeek_preflight_cache');
const previewCache = new CacheManager<{ summary: string; outline?: string[]; overview?: string; imageDescription?: string; imageUrl?: string }>('hoverpeek_preview_cache');

let summarizerAvailable: string | null = null;
let promptAvailable: string | null = null;
let offscreenDocumentCreated = false;

// Get the domain from a URL
function extractDomain(url: URL): string {
  try {
    const hostname = url.hostname;
    return hostname;
  } catch {
    return url.hostname;
  }
}

// Figure out what video platform this is (YouTube, Vimeo, etc.)
function detectVideoPlatform(url: URL): VideoPlatform | null {
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname;
  
  if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
    let videoId: string | undefined;
    
    if (hostname.includes('youtu.be')) {
      videoId = pathname.split('/')[1]?.split('?')[0];
    } else if (pathname.includes('/watch')) {
      videoId = url.searchParams.get('v') || undefined;
    } else if (pathname.includes('/embed/')) {
      videoId = pathname.split('/embed/')[1]?.split('?')[0];
    } else if (pathname.includes('/shorts/')) {
      videoId = pathname.split('/shorts/')[1]?.split('?')[0];
    }
    
    return {
      platform: 'youtube',
      videoId,
      embedUrl: videoId ? `https://www.youtube.com/embed/${videoId}` : undefined,
    };
  }
  
  if (hostname.includes('vimeo.com')) {
    const videoId = pathname.split('/').filter(Boolean)[0];
    return {
      platform: 'vimeo',
      videoId,
      embedUrl: videoId ? `https://player.vimeo.com/video/${videoId}` : undefined,
    };
  }
  
  if (hostname.includes('dailymotion.com') || hostname.includes('dai.ly')) {
    let videoId: string | undefined;
    
    if (hostname.includes('dai.ly')) {
      videoId = pathname.split('/')[1];
    } else if (pathname.includes('/video/')) {
      videoId = pathname.split('/video/')[1]?.split('_')[0];
    }
    
    return {
      platform: 'dailymotion',
      videoId,
      embedUrl: videoId ? `https://www.dailymotion.com/embed/video/${videoId}` : undefined,
    };
  }
  
  if (hostname.includes('tiktok.com')) {
    return {
      platform: 'tiktok',
      videoId: pathname,
    };
  }
  
  if (hostname.includes('twitch.tv')) {
    return {
      platform: 'twitch',
      videoId: pathname,
    };
  }
  
  const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v'];
  if (videoExts.some(ext => pathname.toLowerCase().endsWith(ext))) {
    return {
      platform: 'video-file',
    };
  }
  
  return null;
}

// Normalize URL and block unsafe schemes
function normalizeAndGate(
  href: string,
  pageOrigin: string
): { url: URL; signals: RiskSignal[] } | null {
  const signals: RiskSignal[] = [];
  
  try {
    const url = new URL(href, pageOrigin);
    
    const dangerousSchemes = ['javascript:', 'data:', 'file:', 'vbscript:'];
    if (dangerousSchemes.some(scheme => url.protocol === scheme)) {
      signals.push({
        level: RiskLevel.Red,
        reason: 'Unsafe scheme',
      });
      return null;
    }
    
    return { url, signals };
  } catch (error) {
    return null;
  }
}

// Is this a same-page anchor link?
function isSamePageAnchor(url: URL, pageOrigin: string): boolean {
  try {
    const pageUrl = new URL(pageOrigin);
    return (
      url.hostname === pageUrl.hostname &&
      url.pathname === pageUrl.pathname &&
      url.hash !== '' &&
      url.search === pageUrl.search
    );
  } catch {
    return false;
  }
}

// Check for homograph attacks (mixed scripts, confusable chars)
function detectHomograph(domain: string): boolean {
  const hasCyrillic = /[\u0400-\u04FF]/.test(domain);
  const hasLatin = /[a-zA-Z]/.test(domain);
  const hasGreek = /[\u0370-\u03FF]/.test(domain);
  
  if ((hasCyrillic && hasLatin) || (hasGreek && hasLatin)) {
    return true;
  }
  
  const confusables = [
    'xn--',
    '\u0430',
    '\u0435',
    '\u043E',
    '\u0440',
    '\u0441',
    '\u0445',
  ];
  
  return confusables.some(char => domain.includes(char));
}

// See if the anchor text says one domain but the link goes somewhere else
function checkAnchorTextMismatch(
  anchorText: string,
  hrefDomain: string
): { textDomain: string; linkDomain: string } | null {
  const domainPattern = /(?:https?:\/\/)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const match = anchorText.match(domainPattern);
  
  if (match && match[1]) {
    const textDomain = match[1].toLowerCase();
    const normalizedHrefDomain = hrefDomain.toLowerCase().replace(/^www\./, '');
    const normalizedTextDomain = textDomain.replace(/^www\./, '');
    
    if (normalizedTextDomain !== normalizedHrefDomain) {
      const extractTopLevel = (domain: string) => {
        const parts = domain.split('.');
        if (parts.length >= 2) {
          return parts.slice(-2).join('.');
        }
        return domain;
      };
      
      return {
        textDomain: extractTopLevel(normalizedTextDomain),
        linkDomain: extractTopLevel(normalizedHrefDomain),
      };
    }
  }
  
  return null;
}

// Flag HTTP links when coming from HTTPS (or chrome-extension for demo)
function checkHttpsDowngrade(targetUrl: URL, pageOrigin: string): boolean {
  try {
    const pageUrl = new URL(pageOrigin);
    return (pageUrl.protocol === 'https:' || pageUrl.protocol === 'chrome-extension:') && targetUrl.protocol === 'http:';
  } catch {
    return false;
  }
}

// Quick checks we can do without hitting the network
function performLexicalChecks(
  url: URL,
  anchorText: string,
  pageOrigin: string
): { signals: RiskSignal[]; textMismatch: { textDomain: string; linkDomain: string } | null } {
  const signals: RiskSignal[] = [];
  let textMismatch = null;
  
  if (detectHomograph(url.hostname)) {
    signals.push({
      level: RiskLevel.Amber,
      reason: 'Suspicious domain characters',
    });
  }
  
  textMismatch = checkAnchorTextMismatch(anchorText, url.hostname);
  
  if (checkHttpsDowngrade(url, pageOrigin)) {
    signals.push({
      level: RiskLevel.Amber,
      reason: 'HTTP (not secure)',
    });
  }
  
  return { signals, textMismatch };
}

// Guess link type from Content-Type header
function determineLinkTypeFromContentType(
  contentType: string,
  contentDisposition: string | null
): LinkType {
  const ct = contentType.toLowerCase();
  
  if (contentDisposition?.toLowerCase().includes('attachment')) {
    return LinkType.Download;
  }
  
  if (ct.includes('application/pdf')) {
    return LinkType.PDF;
  }
  
  if (ct.startsWith('image/')) {
    return LinkType.Image;
  }
  
  if (ct.startsWith('video/') || ct.includes('application/x-mpegurl')) {
    return LinkType.Video;
  }
  
  const downloadTypes = [
    'application/octet-stream',
    'application/x-msdownload',
    'application/x-msdos-program',
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/x-gzip',
  ];
  
  if (downloadTypes.some(type => ct.includes(type))) {
    return LinkType.Download;
  }
  
  if (ct.includes('text/html') || ct.includes('application/xhtml')) {
    return LinkType.Webpage;
  }
  
  return LinkType.Webpage;
}

// Fallback: guess link type from the URL path
function guesslinkTypeFromUrl(url: string): LinkType | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    
    if (pathname.endsWith('.pdf') || pathname.includes('/pdf/')) {
      return LinkType.PDF;
    }
    
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'];
    if (imageExts.some(ext => pathname.endsWith(ext))) {
      return LinkType.Image;
    }
    
    const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v'];
    if (videoExts.some(ext => pathname.endsWith(ext))) {
      return LinkType.Video;
    }
    
    const downloadExts = ['.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.dmg', '.deb', '.rpm'];
    if (downloadExts.some(ext => pathname.endsWith(ext))) {
      return LinkType.Download;
    }
    
    return null;
  } catch {
    return null;
  }
}

// Check file signature (magic bytes) to confirm file type
function checkMagicBytes(bytes: Uint8Array): LinkType | null {
  if (bytes.length >= 4 && 
      bytes[0] === 0x25 && bytes[1] === 0x50 && 
      bytes[2] === 0x44 && bytes[3] === 0x46) {
    return LinkType.PDF;
  }
  
  if (bytes.length >= 4 && 
      bytes[0] === 0x50 && bytes[1] === 0x4B && 
      (bytes[2] === 0x03 || bytes[2] === 0x05)) {
    return LinkType.Download;
  }
  
  if (bytes.length >= 2 && bytes[0] === 0x4D && bytes[1] === 0x5A) {
    return LinkType.Download;
  }
  
  if (bytes.length >= 4 && 
      bytes[0] === 0x7F && bytes[1] === 0x45 && 
      bytes[2] === 0x4C && bytes[3] === 0x46) {
    return LinkType.Download;
  }
  
  return null;
}

interface HeadResult {
  finalUrl: string;
  contentType: string;
  contentLength: number | null;
  contentDisposition: string | null;
  redirectCount: number;
  signals: RiskSignal[];
}

// HEAD request, following redirects
async function performHeadRequest(url: URL): Promise<HeadResult> {
  const signals: RiskSignal[] = [];
  let currentUrl = url.href;
  let redirectCount = 0;
  const maxRedirects = 3;
  const timeout = 1500;
  
  while (redirectCount <= maxRedirects) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(currentUrl, {
        method: 'HEAD',
        credentials: 'omit',
        redirect: 'manual',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.status === 405) {
        const guessedType = guesslinkTypeFromUrl(currentUrl);
        let fallbackContentType = 'text/html';
        
        if (guessedType === LinkType.PDF) {
          fallbackContentType = 'application/pdf';
        } else if (guessedType === LinkType.Image) {
          fallbackContentType = 'image/jpeg';
        } else if (guessedType === LinkType.Video) {
          fallbackContentType = 'video/mp4';
        } else if (guessedType === LinkType.Download) {
          fallbackContentType = 'application/octet-stream';
        }
        
        return {
          finalUrl: currentUrl,
          contentType: fallbackContentType,
          contentLength: null,
          contentDisposition: null,
          redirectCount,
          signals,
        };
      }
      
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        if (location) {
          redirectCount++;
          if (redirectCount > maxRedirects) {
            signals.push({
              level: RiskLevel.Amber,
              reason: `Redirects x${redirectCount}`,
            });
            break;
          }
          currentUrl = new URL(location, currentUrl).href;
          continue;
        }
      }
      
      if (redirectCount >= 2) {
        signals.push({
          level: RiskLevel.Amber,
          reason: `Redirects x${redirectCount}`,
        });
      }
      
      const contentType = response.headers.get('Content-Type') || 'text/html';
      const contentLength = response.headers.get('Content-Length');
      const contentDisposition = response.headers.get('Content-Disposition');
      
      return {
        finalUrl: currentUrl,
        contentType,
        contentLength: contentLength ? parseInt(contentLength, 10) : null,
        contentDisposition,
        redirectCount,
        signals,
      };
    } catch (error) {
      const guessedType = guesslinkTypeFromUrl(currentUrl);
      let fallbackContentType = 'text/html';
      
      if (guessedType === LinkType.PDF) {
        fallbackContentType = 'application/pdf';
      } else if (guessedType === LinkType.Image) {
        fallbackContentType = 'image/jpeg';
      } else if (guessedType === LinkType.Video) {
        fallbackContentType = 'video/mp4';
      }
      
      return {
        finalUrl: currentUrl,
        contentType: fallbackContentType,
        contentLength: null,
        contentDisposition: null,
        redirectCount,
        signals,
      };
    }
  }
  
  const guessedType = guesslinkTypeFromUrl(currentUrl);
  let fallbackContentType = 'text/html';
  
  if (guessedType === LinkType.PDF) {
    fallbackContentType = 'application/pdf';
  } else if (guessedType === LinkType.Image) {
    fallbackContentType = 'image/jpeg';
  } else if (guessedType === LinkType.Video) {
    fallbackContentType = 'video/mp4';
  }
  
  return {
    finalUrl: currentUrl,
    contentType: fallbackContentType,
    contentLength: null,
    contentDisposition: null,
    redirectCount,
    signals,
  };
}

// Optional: fetch first 4KB to check magic bytes
async function performSniff(url: string): Promise<LinkType | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: {
        'Range': 'bytes=0-4095', // Just the first 4KB
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    
    return checkMagicBytes(bytes);
  } catch {
    return null;
  }
}

// Turn signals into a risk level (red > amber > green)
function scoreRisk(signals: RiskSignal[]): { risk: RiskLevel; reasons: string[] } {
  if (signals.length === 0) {
    return { risk: RiskLevel.Green, reasons: [] };
  }
  
  const redSignals = signals.filter(s => s.level === RiskLevel.Red);
  if (redSignals.length > 0) {
    return {
      risk: RiskLevel.Red,
      reasons: redSignals.slice(0, 2).map(s => s.reason),
    };
  }
  
  const amberSignals = signals.filter(s => s.level === RiskLevel.Amber);
  if (amberSignals.length > 0) {
    return {
      risk: RiskLevel.Amber,
      reasons: amberSignals.slice(0, 2).map(s => s.reason),
    };
  }
  
  return { risk: RiskLevel.Green, reasons: [] };
}

// Pick what kind of fetch to do (or block it)
function decideFetchPlan(type: LinkType, risk: RiskLevel): FetchPlan {
  if (type === LinkType.Blocked) {
    return FetchPlan.Blocked;
  }
  
  if (risk === RiskLevel.Red && type === LinkType.Download) {
    return FetchPlan.Blocked;
  }
  
  if ([LinkType.Mailto, LinkType.Tel, LinkType.Anchor, LinkType.Video].includes(type)) {
    return FetchPlan.NoFetch;
  }
  
  if (type === LinkType.Image) {
    return FetchPlan.PartialGet;
  }
  
  if (type === LinkType.Webpage || type === LinkType.PDF) {
    return FetchPlan.PartialGet;
  }
  
  if (type === LinkType.Download) {
    return FetchPlan.HeadOnly;
  }
  
  return FetchPlan.PartialGet;
}

async function checkAIAvailability(): Promise<void> {
  try {
    if ('Summarizer' in self) {
      summarizerAvailable = await Summarizer.availability();
    } else {
      summarizerAvailable = 'unavailable';
    }
  } catch (error) {
    console.error('[AI] Error checking Summarizer availability:', error);
    summarizerAvailable = 'unavailable';
  }

  try {
    if ('LanguageModel' in self) {
      promptAvailable = await LanguageModel.availability();
    } else {
      promptAvailable = 'unavailable';
    }
  } catch (error) {
    console.error('[AI] Error checking Prompt API availability:', error);
    promptAvailable = 'unavailable';
  }
}

checkAIAvailability().catch((error) => {
  console.error('[AI] Failed to check availability:', error);
});

async function injectContentScriptIntoExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      // Skip internal Chrome pages
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
        continue;
      }
      
      if (!tab.id) {
        continue;
      }
      
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content.css'],
        });
        
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
      } catch (error) {
        // Tab might not accept script injection, skip silently
      }
    }
  } catch (error) {
    console.error('[Init] Failed to inject content scripts:', error);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.action.openPopup().catch(() => {
      chrome.windows.create({
        url: 'popup.html',
        type: 'popup',
        width: 360,
        height: 480,
      });
    });
  }
  
  if (details.reason === 'install' || details.reason === 'update') {
    injectContentScriptIntoExistingTabs();
  }
});

// Hash data for cache keys
async function generateHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Make sure we have an offscreen doc for parsing
async function setupOffscreenDocument(): Promise<void> {
  if (offscreenDocumentCreated) {
    return;
  }

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });

  if (existingContexts.length > 0) {
    offscreenDocumentCreated = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER' as chrome.offscreen.Reason],
    justification: 'Parse HTML and PDF content safely',
  });

  offscreenDocumentCreated = true;
}

// Fetch just the first N bytes of a file
async function performPartialFetch(url: string, maxBytes: number = 65536): Promise<{ data: ArrayBuffer; contentType: string }> {
  const controller = new AbortController();
  // Give PDFs more time since they're bigger
  const timeout = maxBytes > 500000 ? 8000 : 3000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': new URL(url).origin + '/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    clearTimeout(timeoutId);

    if (response.status === 999) {
      throw new Error('HTTP 999 - Cloudflare protection');
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('Content-Type') || 'text/html';
    
    // Stream response until we hit maxBytes
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (totalLength < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      totalLength += value.length;
      
      if (totalLength >= maxBytes) {
        reader.cancel();
        break;
      }
    }

    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return { data: combined.buffer, contentType };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
}

// Get AI description of an image
async function generateImageDescription(
  imageBlob: Blob
): Promise<string> {
  if (promptAvailable !== 'available') {
    return '';
  }

  try {
    const session = await LanguageModel.create({
      initialPrompts: [
        {
          role: 'system',
          content: 'You are a helpful assistant that provides concise image descriptions.',
        },
      ],
      expectedInputs: [{ type: 'image' }],
    });

    await session.append([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            value: 'Provide a brief description of this image in under 30 words.',
          },
          { type: 'image', value: imageBlob },
        ],
      },
    ]);

    const description = await session.prompt('');
    session.destroy();

    const words = description.split(/\s+/);
    if (words.length > 30) {
      return words.slice(0, 30).join(' ') + '...';
    }

    return description;
  } catch (error) {
    console.error('[Preview] Image description generation failed:', error);
    return '';
  }
}

// Generate AI overview for a webpage
async function generateWebpagePreview(
  html: string,
  url: string,
  onOverview?: (overview: string) => void
): Promise<{ overview: string }> {
  try {
    await setupOffscreenDocument();

    const parseResponse: any = await chrome.runtime.sendMessage({
      type: 'parseHTML',
      html,
      url,
    });

    if (!parseResponse.success) {
      console.error('[Preview] HTML parsing failed:', parseResponse.error);
      return { overview: '' };
    }

    const excerpt = parseResponse.excerpt;

    let overview = '';

    if (promptAvailable === 'available') {
      try {
        const session = await LanguageModel.create();
        const overviewPrompt = `Based on this webpage content from ${url}, provide a concise 2-3 sentence overview explaining what this page is about and what value it offers to readers:\n\n${excerpt}`;
        overview = await session.prompt(overviewPrompt);
        if (onOverview) {
          onOverview(overview);
        }
        session.destroy();
      } catch (error) {
        console.error('[Preview] Webpage overview generation failed:', error);
      }
    }
    
    return { overview };
  } catch (error) {
    console.error('[Preview] Webpage preview generation failed:', error);
    return { overview: '' };
  }
}

// Generate outline and summary for a PDF
async function generatePDFPreview(
  arrayBuffer: ArrayBuffer,
  onOutline: (outline: string[]) => void,
  onSummary: (summary: string) => void
): Promise<{ outline: string[]; summary: string }> {
  if (promptAvailable !== 'available' && summarizerAvailable !== 'available') {
    return { outline: [], summary: '' };
  }

  try {
    await setupOffscreenDocument();

    const uint8Array = new Uint8Array(arrayBuffer);

    const parseResponse: any = await chrome.runtime.sendMessage({
      type: 'parsePDF',
      pdfData: Array.from(uint8Array),
    });

    if (!parseResponse.success) {
      console.error('[Preview] PDF parsing failed:', parseResponse.error);
      return { outline: [], summary: '' };
    }

    const { text } = parseResponse;

    const maxPromptLength = 2 * 1024;
    const truncatedForPrompt = text.length > maxPromptLength 
      ? text.substring(0, maxPromptLength)
      : text;

    let outline: string[] = [];
    let summary = '';

    if (promptAvailable === 'available') {
      try {
        const session = await LanguageModel.create();
        const outlinePrompt = `Extract up to 5 informative headings from this PDF text. Output one heading per line, no numbering or bullets:\n\n${truncatedForPrompt}`;
        const outlineResult = await session.prompt(outlinePrompt);
        
        outline = outlineResult
          .split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0 && line.length < 100)
          .slice(0, 5);

        onOutline(outline);
        session.destroy();
      } catch (error) {
        console.error('[Preview] PDF outline generation failed:', error);
      }
    }

    if (summarizerAvailable === 'available') {
      try {
        const maxSummarizerLength = 4 * 1024;
        const truncatedForSummarizer = text.length > maxSummarizerLength 
          ? text.substring(0, maxSummarizerLength)
          : text;

        const summarizer = await Summarizer.create({
          type: 'tldr',
          format: 'plain-text',
          length: 'short',
          expectedInputLanguages: ['en'],
          outputLanguage: 'en',
        });

        const summaryResult = await summarizer.summarize(truncatedForSummarizer);
        summary = summaryResult;
        onSummary(summary);
        summarizer.destroy();
      } catch (error) {
        console.error('[Preview] PDF summary generation failed:', error);
      }
    }

    return { outline, summary };
  } catch (error) {
    console.error('[Preview] PDF preview generation failed:', error);
    return { outline: [], summary: '' };
  }
}

// Generate overview and risk note for downloads
async function generateDownloadPreview(preflightResult: PreflightResult): Promise<{ overview: string; riskNote: string }> {
  if (promptAvailable !== 'available') {
    return { overview: '', riskNote: '' };
  }

  try {
    const session = await LanguageModel.create();
    
    const fileName = preflightResult.finalUrl.split('/').pop() || 'file';
    const fileExt = fileName.split('.').pop()?.toLowerCase() || '';
    const domain = preflightResult.domain;
    const size = preflightResult.size ? `${(preflightResult.size / (1024 * 1024)).toFixed(1)} MB` : 'unknown size';
    
    const overviewPrompt = `You're helping a user understand what they're about to download. Based on this info, write a brief 1-2 sentence description of what this download likely contains:
- Filename: ${fileName}
- File type: ${fileExt}
- From: ${domain}
- Size: ${size}

Be helpful and specific. Start with what it is (e.g., "Source code archive", "Software installer", "Document").`;
    
    const overview = await session.prompt(overviewPrompt);
    
    let riskNote = '';
    if (preflightResult.reasons.length > 0 || preflightResult.risk !== RiskLevel.Green) {
      const signals = [
        preflightResult.type === LinkType.Download ? 'Download file' : 'File',
        ...preflightResult.reasons,
        preflightResult.redirectCount && preflightResult.redirectCount > 0 
          ? `${preflightResult.redirectCount} redirects` 
          : '',
        preflightResult.size ? size : '',
      ].filter(Boolean);

      const riskPrompt = `Convert these security signals into a single, clear, ≤120 character risk note for a user:\n${signals.join(', ')}\n\nBe specific and calm. Start with the main risk.`;
      
      riskNote = await session.prompt(riskPrompt);
      riskNote = riskNote.length > 120 ? riskNote.substring(0, 117) + '...' : riskNote;
    }
    
    session.destroy();

    return { overview, riskNote };
  } catch (error) {
    console.error('[Preview] Download preview generation failed:', error);
    return { overview: '', riskNote: '' };
  }
}

// Main entry point for generating previews
async function generatePreview(
  preflightResult: PreflightResult,
  onUpdate: (update: any) => void
): Promise<void> {
  const { type, risk, fetchPlan, finalUrl } = preflightResult;

  if (risk === RiskLevel.Red) {
    onUpdate({ aiAvailable: false, reason: 'High risk link' });
    return;
  }

  const shouldProcess = 
    (type === LinkType.Webpage || type === LinkType.PDF || type === LinkType.Image) && fetchPlan === FetchPlan.PartialGet ||
    type === LinkType.Download && fetchPlan === FetchPlan.HeadOnly;

  if (!shouldProcess) {
    return;
  }

  const aiAvailable = summarizerAvailable === 'available' || promptAvailable === 'available';
  if (!aiAvailable) {
    onUpdate({ 
      aiAvailable: false, 
      reason: summarizerAvailable === 'downloading' || promptAvailable === 'downloading'
        ? 'AI models downloading...'
        : 'AI features not available'
    });
    return;
  }

  const cacheKey = await generateHash(finalUrl + type + fetchPlan);

  const cached = await previewCache.get(cacheKey);
  if (cached) {
    const update: any = { 
      aiAvailable: true,
      cached: true,
      outline: cached.data.outline,
      overview: cached.data.overview,
      imageDescription: cached.data.imageDescription,
      imageUrl: cached.data.imageUrl,
    };
    if (preflightResult.type === LinkType.PDF && cached.data.summary) {
      update.summary = cached.data.summary;
    }
    onUpdate(update);
    return;
  }

  try {
    if (type === LinkType.Download) {
      const { overview, riskNote } = await generateDownloadPreview(preflightResult);
      if (overview || riskNote) {
        await previewCache.set(cacheKey, { summary: overview, overview });
        onUpdate({ 
          aiAvailable: true,
          overview,
          riskNote: riskNote || undefined,
        });
      }
      return;
    }

    if (type === LinkType.Webpage) {
      const { data } = await performPartialFetch(finalUrl, 49152);
      
      const decoder = new TextDecoder();
      const html = decoder.decode(data);
      
      const result = await generateWebpagePreview(
        html, 
        finalUrl,
        (overview) => {
          onUpdate({ 
            aiAvailable: true,
            overview,
          });
        }
      );
      
      if (result.overview) {
      await previewCache.set(cacheKey, { 
        summary: '',
        overview: result.overview
      });
      }
    }

    if (type === LinkType.PDF) {
      const { data } = await performPartialFetch(finalUrl, 2 * 1024 * 1024);
      
      const result = await generatePDFPreview(
        data,
        (outline) => {
          onUpdate({ 
            aiAvailable: true,
            outline,
          });
        },
        (summary) => {
          onUpdate({ 
            aiAvailable: true,
            summary,
          });
        }
      );

      if (result.outline.length > 0 || result.summary) {
        await previewCache.set(cacheKey, { 
          summary: result.summary, 
          outline: result.outline
        });
      }
    }

    if (type === LinkType.Image) {
      const { data, contentType } = await performPartialFetch(finalUrl, 5 * 1024 * 1024);
      
      const blob = new Blob([data], { type: contentType || 'image/jpeg' });
      
      const reader = new FileReader();
      const imageUrl = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      
      const description = await generateImageDescription(blob);
      
      if (description || imageUrl) {
        onUpdate({ 
          aiAvailable: true,
          imageDescription: description,
          imageUrl,
        });
        
        await previewCache.set(cacheKey, { 
          summary: '',
          imageDescription: description,
          imageUrl
        });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (errorMessage.includes('HTTP 999') || errorMessage.includes('Cloudflare protection')) {
      onUpdate({ 
        aiAvailable: false,
        reason: 'This site is protected by Cloudflare and cannot be previewed. Basic information is still available.',
      });
      return;
    }
    
    const isCommonFailure = errorMessage.includes('HTTP 404') || 
                           errorMessage.includes('HTTP 403') || 
                           errorMessage.includes('HTTP 410') ||
                           errorMessage.includes('Failed to fetch') ||
                           errorMessage.includes('CORS') ||
                           errorMessage.includes('timed out');
    
    if (isCommonFailure) {
      onUpdate({ 
        aiAvailable: true,
        clearLoading: true,
      });
    } else {
      onUpdate({ 
        aiAvailable: true,
        error: 'Preview unavailable',
      });
    }
  }
}

async function performPreflightCheck(
  href: string,
  anchorText: string,
  pageOrigin: string
): Promise<PreflightResult> {
  const allSignals: RiskSignal[] = [];
  
  const normalized = normalizeAndGate(href, pageOrigin);
  if (!normalized) {
    return {
      domain: 'blocked',
      type: LinkType.Blocked,
      risk: RiskLevel.Red,
      reasons: ['Unsafe scheme'],
      finalUrl: href,
      fetchPlan: FetchPlan.Blocked,
    };
  }
  
  const { url, signals: gateSignals } = normalized;
  allSignals.push(...gateSignals);
  
  if (url.protocol === 'mailto:') {
    return {
      domain: url.hostname || 'email',
      type: LinkType.Mailto,
      risk: RiskLevel.Green,
      reasons: [],
      finalUrl: url.href,
      fetchPlan: FetchPlan.NoFetch,
    };
  }
  
  if (url.protocol === 'tel:') {
    return {
      domain: url.hostname || 'phone',
      type: LinkType.Tel,
      risk: RiskLevel.Green,
      reasons: [],
      finalUrl: url.href,
      fetchPlan: FetchPlan.NoFetch,
    };
  }
  
  if (isSamePageAnchor(url, pageOrigin)) {
    return {
      domain: extractDomain(url),
      type: LinkType.Anchor,
      risk: RiskLevel.Green,
      reasons: [],
      finalUrl: url.href,
      fetchPlan: FetchPlan.NoFetch,
    };
  }
  
  const lexicalResult = performLexicalChecks(url, anchorText, pageOrigin);
  allSignals.push(...lexicalResult.signals);
  const textMismatch = lexicalResult.textMismatch;
  
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    const headResult = await performHeadRequest(url);
    allSignals.push(...headResult.signals);
    
    let type = determineLinkTypeFromContentType(
      headResult.contentType,
      headResult.contentDisposition
    );
    
    const urlBasedType = guesslinkTypeFromUrl(headResult.finalUrl);
    if (urlBasedType) {
      type = urlBasedType;
    }
    
    if (type === LinkType.Download && headResult.contentType.includes('octet-stream')) {
      const sniffedType = await performSniff(headResult.finalUrl);
      if (sniffedType) {
        type = sniffedType;
        
        if (sniffedType === LinkType.Download) {
          allSignals.push({
            level: RiskLevel.Red,
            reason: 'Executable download',
          });
        }
      }
    }
    
    const { risk, reasons } = scoreRisk(allSignals);
    
    const fetchPlan = decideFetchPlan(type, risk);
    
    let videoPlatform: VideoPlatform | undefined;
    if (type === LinkType.Video) {
      const detected = detectVideoPlatform(new URL(headResult.finalUrl));
      if (detected) {
        videoPlatform = detected;
      }
    }
    
    return {
      domain: extractDomain(new URL(headResult.finalUrl)),
      type,
      risk,
      reasons,
      size: headResult.contentLength || undefined,
      finalUrl: headResult.finalUrl,
      fetchPlan,
      redirectCount: headResult.redirectCount,
      textMismatch: textMismatch || undefined,
      videoPlatform,
    };
  }
  
  return {
    domain: extractDomain(url),
    type: LinkType.Blocked,
    risk: RiskLevel.Red,
    reasons: ['Unknown protocol'],
    finalUrl: url.href,
    fetchPlan: FetchPlan.Blocked,
  };
}

async function fetchLinkTitle(url: string): Promise<string> {
  const cached = await titleCache.get(url);
  if (cached) {
    return cached.data;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    
    if (titleMatch && titleMatch[1]) {
      const title = titleMatch[1].trim();
      await titleCache.set(url, title);
      return title;
    }
    
    return 'Untitled';
  } catch (error) {
    console.error('Error fetching link title:', error);
    return 'Unable to load title';
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'fetchLinkTitle') {
    fetchLinkTitle(message.url)
      .then((title) => {
        sendResponse({ success: true, title });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  }
  
  if (message.type === 'preflightCheck') {
    const { href, anchorText, pageOrigin } = message;
    
    (async () => {
      const cached = await preflightCache.get(href);
      if (cached) {
        sendResponse({ success: true, result: cached.data });
        return;
      }
      
      performPreflightCheck(href, anchorText || '', pageOrigin)
        .then(async (result) => {
          await preflightCache.set(href, result);
          sendResponse({ success: true, result });
        })
      .catch((error) => {
          console.error('Preflight check error:', error);
          sendResponse({
            success: true,
            result: {
              domain: 'unknown',
              type: LinkType.Webpage,
              risk: RiskLevel.Amber,
              reasons: ['Unable to check'],
              finalUrl: href,
              fetchPlan: FetchPlan.PartialGet,
            },
          });
        });
    })();
    
    return true;
  }
  
  if (message.type === 'generatePreview') {
    const { preflightResult } = message;
    
    generatePreview(preflightResult, (update) => {
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'previewUpdate',
          update,
        }).catch(() => {
        });
      }
    })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Preview generation error:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  }
  
  if (message.type === 'getAIStatus') {
    sendResponse({
      summarizer: summarizerAvailable,
      languageModel: promptAvailable,
    });
    return true;
  }
  
  if (message.type === 'downloadSummarizer') {
    (async () => {
      try {
        summarizerAvailable = 'downloading';
        
        const summarizer = await Summarizer.create({
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, {
                  type: 'downloadProgress',
                  api: 'summarizer',
                  progress: e.loaded,
                }).catch(() => {});
              }
              chrome.runtime.sendMessage({
                type: 'downloadProgress',
                api: 'summarizer',
                progress: e.loaded,
              }).catch(() => {});
            });
          }
        });
        
        summarizer.destroy();
        
        summarizerAvailable = await Summarizer.availability();
        
        sendResponse({ success: true, status: summarizerAvailable });
      } catch (error) {
        console.error('[AI] Summarizer download error:', error);
        summarizerAvailable = 'unavailable';
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }
  
  if (message.type === 'downloadLanguageModel') {
    (async () => {
      try {
        promptAvailable = 'downloading';
        
        const session = await LanguageModel.create({
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, {
                  type: 'downloadProgress',
                  api: 'languageModel',
                  progress: e.loaded,
                }).catch(() => {});
              }
              chrome.runtime.sendMessage({
                type: 'downloadProgress',
                api: 'languageModel',
                progress: e.loaded,
              }).catch(() => {});
            });
          }
        });
        
        session.destroy();
        
        promptAvailable = await LanguageModel.availability();
        
        sendResponse({ success: true, status: promptAvailable });
      } catch (error) {
        console.error('[AI] LanguageModel download error:', error);
        promptAvailable = 'unavailable';
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }
  
  if (message.type === 'clearCache') {
    (async () => {
      try {
        await Promise.all([
          titleCache.clear(),
          preflightCache.clear(),
          previewCache.clear(),
        ]);
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Cache] Failed to clear caches:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }
});

