
export interface OSMPoint {
  lat: number;
  lon: number;
  speed: string | null;
  wayId: number | null;
}

export interface GeminiAnalysisResult {
  speed_limit: number | null;
  confidence: number;
}

export interface AnalyzedPoint {
  id: string;
  location: OSMPoint;
  osmSpeed: string | null;
  detectedSpeed: number | null;
  confidence: number | null;
  isDiscrepancy: boolean;
  imageUrl: string;
  heading: number;
  wayId: number | null;
  imageDate: string | null;
}