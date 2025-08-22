
const GOOGLE_API_KEY_ENV = process.env.STREET_VIEW_API_KEY || process.env.API_KEY;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export async function getStreetViewMetadata(
    lat: number, 
    lon: number,
    uiApiKey?: string,
): Promise<{ success: true; date: string } | { success: false; error: string }> {
  const effectiveApiKey = uiApiKey || GOOGLE_API_KEY_ENV;

  if (!effectiveApiKey) {
    const errorMsg = "Google API key is not configured for metadata lookup.";
    return { success: false, error: errorMsg };
  }
  
  const metadataUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lon}&key=${effectiveApiKey}`;

  try {
    const response = await fetch(metadataUrl);
    if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `Metadata API returned ${response.status}: ${errorText}` };
    }
    const data = await response.json();
    if (data.status !== 'OK') {
        return { success: false, error: `Metadata status: ${data.status}. No imagery found.` };
    }
    return { success: true, date: data.date };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown network error.";
    return { success: false, error: `Network error fetching metadata: ${errorMessage}` };
  }
}

export async function getStreetViewImage(
    lat: number, 
    lon: number, 
    heading: number,
    uiApiKey?: string,
): Promise<{ success: true; base64: string; url: string } | { success: false; error: string }> {
  const effectiveApiKey = uiApiKey || GOOGLE_API_KEY_ENV;

  if (!effectiveApiKey) {
    const errorMsg = "Google API key is not configured. Please set API_KEY or provide one in the UI.";
    console.error(errorMsg);
    return { success: false, error: errorMsg };
  }
  
  const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lon}&heading=${heading}&fov=90&source=outdoor&key=${effectiveApiKey}`;
  
  try {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      let errorBody = 'Could not read error response body.';
      try {
        errorBody = await response.text();
      } catch (e) { /* ignore */ }
      
      let errorMessage;
      if (response.status === 403) {
          errorMessage = `Street View API request failed: 403 Forbidden. This commonly means the API key is missing permissions. Please ensure the "Street View Static API" is enabled in your Google Cloud project. Original response: ${errorBody}`;
      } else {
          errorMessage = `Street View API request failed with status ${response.status} ${response.statusText}. Response: ${errorBody}`;
      }
      console.error(errorMessage);
      return { success: false, error: errorMessage };
    }
    
    // The placeholder image for "not found" is small. We can check the content length.
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) < 5000) {
        const errorMsg = "Street View imagery not available at this location.";
        return { success: false, error: errorMsg };
    }

    const blob = await response.blob();
    if(blob.type !== 'image/jpeg'){
      const errorMsg = "Street View returned non-JPEG content, likely indicating no imagery is available.";
      return { success: false, error: errorMsg };
    }

    const arrayBuffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    
    return { success: true, base64, url: imageUrl };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown network error occurred.";
    console.error("Error fetching Street View image:", error);
    return { success: false, error: `Network error while fetching Street View image: ${errorMessage}` };
  }
}