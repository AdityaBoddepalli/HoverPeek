import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');

function parseHTML(html: string, url: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const parts: string[] = [];
  
  const title = doc.querySelector('title')?.textContent?.trim();
  if (title) {
    parts.push(`Title: ${title}`);
  }
  
  const ogDescription = doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
  if (ogDescription) {
    parts.push(`Description: ${ogDescription.trim()}`);
  }
  
  if (!ogDescription) {
    const twitterDescription = doc.querySelector('meta[name="twitter:description"]')?.getAttribute('content');
    if (twitterDescription) {
      parts.push(`Description: ${twitterDescription.trim()}`);
    }
  }
  
  if (!ogDescription) {
    const metaDescription = doc.querySelector('meta[name="description"]')?.getAttribute('content');
    if (metaDescription) {
      parts.push(`Description: ${metaDescription.trim()}`);
    }
  }
  
  const keywords = doc.querySelector('meta[name="keywords"]')?.getAttribute('content');
  if (keywords) {
    parts.push(`Keywords: ${keywords.trim()}`);
  }
  
  const h1 = doc.querySelector('h1')?.textContent?.trim();
  if (h1 && h1 !== title) {
    parts.push(`Main Heading: ${h1}`);
  }
  
  const h2s = Array.from(doc.querySelectorAll('h2'))
    .slice(0, 5)
    .map(h2 => h2.textContent?.trim())
    .filter(Boolean);
  if (h2s.length > 0) {
    parts.push(`Subheadings: ${h2s.join(' • ')}`);
  }
  
  const h3s = Array.from(doc.querySelectorAll('h3'))
    .slice(0, 5)
    .map(h3 => h3.textContent?.trim())
    .filter(Boolean);
  if (h3s.length > 0) {
    parts.push(`Sub-sections: ${h3s.join(' • ')}`);
  }
  
  const paragraphs = Array.from(doc.querySelectorAll('p'))
    .map(p => p.textContent?.trim())
    .filter(p => p && p.length > 40) // Skip super short ones
    .slice(0, 5);
  
  if (paragraphs.length > 0) {
    parts.push(`Content:\n${paragraphs.join('\n\n')}`);
  }
  
  const listItems = Array.from(doc.querySelectorAll('li'))
    .map(li => li.textContent?.trim())
    .filter(li => li && li.length > 20 && li.length < 200) // Only meaningful items
    .slice(0, 8);
  
  if (listItems.length > 0) {
    parts.push(`Key Points:\n${listItems.map(item => `• ${item}`).join('\n')}`);
  }
  
  return parts.join('\n\n');
}

interface PDFParseResult {
  text: string;
  pageCount: number;
}

// Extract text from first couple pages of a PDF
async function parsePDF(arrayBuffer: ArrayBuffer): Promise<PDFParseResult> {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    const pageCount = pdf.numPages;
    const pagesToExtract = Math.min(2, pageCount); // Just grab first 2 pages
    
    const textParts: string[] = [];
    
    for (let i = 1; i <= pagesToExtract; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
        .trim();
      
      if (pageText) {
        textParts.push(`Page ${i}: ${pageText}`);
      }
    }
    
    const text = textParts.join('\n\n');
    
    const maxLength = 4 * 1024;
    const truncatedText = text.length > maxLength 
      ? text.substring(0, maxLength) + '...'
      : text;
    
    return {
      text: truncatedText,
      pageCount,
    };
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'parseHTML') {
    try {
      const excerpt = parseHTML(message.html, message.url);
      sendResponse({ success: true, excerpt });
    } catch (error) {
      sendResponse({ 
        success: false, 
        error: error instanceof Error ? error.message : 'HTML parsing failed' 
      });
    }
    return true;
  }
  
  if (message.type === 'parsePDF') {
    const uint8Array = new Uint8Array(message.pdfData);
    const arrayBuffer = uint8Array.buffer;
    
    parsePDF(arrayBuffer)
      .then((result) => {
        sendResponse({ success: true, ...result });
      })
      .catch((error) => {
        sendResponse({ 
          success: false, 
          error: error instanceof Error ? error.message : 'PDF parsing failed' 
        });
      });
    return true;
  }
  
  return false;
});
