import React, { useState, useCallback, useRef, useEffect } from 'react';
import Header from './components/Header';
import Loader from './components/Loader';
import StatusLog from './components/StatusLog';
import ResultDetailModal from './components/ResultDetailModal';
import CostEstimator from './components/CostEstimator';
import ApiKeyInstructionsModal from './components/ApiKeyInstructionsModal';
import { fetchStreetData, getSamplePoints, clearOSMCache } from './services/osmService';
import { getStreetViewImage, getStreetViewMetadata } from './services/streetViewService';
import { analyzeSpeedSign } from './services/geminiService';
import { generatePdfReport } from './services/pdfService';
import { generateTimelapseVideo } from './services/videoService';
import type { AnalyzedPoint, GeminiAnalysisResult, OSMPoint } from './types';
import { US_STATES, CANADIAN_PROVINCES } from './constants';

function calculateBearing(p1: OSMPoint, p2: OSMPoint): number {
  const toRadians = (deg: number) => deg * Math.PI / 180;
  const toDegrees = (rad: number) => rad * 180 / Math.PI;

  const lat1 = toRadians(p1.lat);
  const lon1 = toRadians(p1.lon);
  const lat2 = toRadians(p2.lat);
  const lon2 = toRadians(p2.lon);

  const dLon = lon2 - lon1;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  
  let brng = toDegrees(Math.atan2(y, x));
  return (brng + 360) % 360; // Normalize to 0-360
}

function offsetLocation(lat: number, lon: number, bearing: number, distanceMeters: number): { lat: number, lon: number } {
    const R = 6371e3; // Earth's radius in meters
    const toRadians = (deg: number) => deg * Math.PI / 180;
    const toDegrees = (rad: number) => rad * 180 / Math.PI;

    const latRad = toRadians(lat);
    const lonRad = toRadians(lon);
    const bearingRad = toRadians(bearing);
    const angularDistance = distanceMeters / R;

    const newLatRad = Math.asin(Math.sin(latRad) * Math.cos(angularDistance) +
                              Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad));

    const newLonRad = lonRad + Math.atan2(Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
                                         Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(newLatRad));

    return { lat: toDegrees(newLatRad), lon: toDegrees(newLonRad) };
}

// Custom style for select dropdowns to replace the default arrow with a custom one.
const selectStyle = {
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='2' stroke='%23ced4da'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' d='m19.5 8.25-7.5 7.5-7.5-7.5' /%3e%3c/svg%3e")`,
  backgroundPosition: 'right 0.75rem center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '1.25em',
};


const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState<boolean>(false);
  const [videoGenerationProgress, setVideoGenerationProgress] = useState<number>(0);
  const [logs, setLogs] = useState<string[]>(['Welcome! Enter a location, configure parameters, and click "Analyze" to begin.']);
  const [analyzedPoints, setAnalyzedPoints] = useState<AnalyzedPoint[]>([]);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isKeyInvalid, setIsKeyInvalid] = useState<boolean>(false);
  const [isInstructionsModalOpen, setIsInstructionsModalOpen] = useState<boolean>(false);
  
  const [country, setCountry] = useState('USA');
  const [provinceState, setProvinceState] = useState(US_STATES[4]); // California
  const [cityName, setCityName] = useState<string>('');
  const [streetName, setStreetName] = useState<string>('');
  const [reverseDirection, setReverseDirection] = useState<boolean>(false);
  const [startOffset, setStartOffset] = useState<number>(0);
  const [samplingDistance, setSamplingDistance] = useState<number>(25);
  const [maxPoints, setMaxPoints] = useState<number>(10);
  const [concurrency, setConcurrency] = useState<number>(5);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.3);

  const [startOffsetInput, setStartOffsetInput] = useState<string>('0');
  const [samplingDistanceInput, setSamplingDistanceInput] = useState<string>('25');
  const [maxPointsInput, setMaxPointsInput] = useState<string>('10');
  const [concurrencyInput, setConcurrencyInput] = useState<string>('5');
  const [confidenceThresholdInput, setConfidenceThresholdInput] = useState<string>('0.3');
  
  const [apiKey, setApiKey] = useState<string>('');
  
  const [progress, setProgress] = useState(0);
  const [totalPointsToAnalyze, setTotalPointsToAnalyze] = useState(0);
  const isCancelledRef = useRef<boolean>(false);

  useEffect(() => { setStartOffsetInput(String(startOffset)); }, [startOffset]);
  useEffect(() => { setSamplingDistanceInput(String(samplingDistance)); }, [samplingDistance]);
  useEffect(() => { setMaxPointsInput(String(maxPoints)); }, [maxPoints]);
  useEffect(() => { setConcurrencyInput(String(concurrency)); }, [concurrency]);
  useEffect(() => { setConfidenceThresholdInput(String(confidenceThreshold)); }, [confidenceThreshold]);

  const addLog = useCallback((message: string) => {
    console.log(message);
    setLogs(prev => [...prev, message]);
  }, []);
  
  const handleStopClick = () => {
    addLog("Cancellation requested. Analysis will stop after current tasks finish.");
    isCancelledRef.current = true;
  };
  
  const handleClearResults = () => {
    setAnalyzedPoints([]);
    setSelectedPointIndex(null);
    setError(null);
    setIsKeyInvalid(false);
    setLogs(['Results cleared. Configure parameters and click "Analyze" to begin.']);
  };

  const handleClearCache = () => {
    if (!streetName || !cityName) return;
    clearOSMCache(streetName, cityName, provinceState);
    addLog(`Cleared locally cached OpenStreetMap data for ${streetName}, ${cityName}, ${provinceState}. The next analysis will fetch fresh data from the server.`);
  };

  const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCountry = e.target.value;
    setCountry(newCountry);
    if (newCountry === 'USA') {
      setProvinceState(US_STATES[4]); // Default to California
    } else {
      setProvinceState(CANADIAN_PROVINCES[8]); // Default to Ontario
    }
  };

  const handleDownloadPdf = async () => {
    if (isGeneratingPdf || analyzedPoints.length === 0) return;
    
    const effectiveApiKey = apiKey || process.env.STREET_VIEW_API_KEY || process.env.API_KEY;

    if (!effectiveApiKey) {
        setError("A Google API key is required to generate map images for the PDF report. Please provide one in the settings.");
        addLog("PDF Generation failed: API key for map images is missing.");
        return;
    }
    
    setIsGeneratingPdf(true);
    setError(null);
    addLog("Generating PDF report... This may take a moment.");
    try {
        const reportMetadata = {
            cityName,
            streetName,
            provinceState,
            startOffset,
            samplingDistance,
            maxPoints,
            confidenceThreshold,
            country,
        };
        await generatePdfReport(analyzedPoints, effectiveApiKey, reportMetadata);
        addLog("PDF report generated successfully.");
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown PDF error";
        addLog(`Error generating PDF: ${message}`);
        setError(`Failed to generate PDF report.`);
    } finally {
        setIsGeneratingPdf(false);
    }
  };

  const handleDownloadVideo = async () => {
    if (isGeneratingVideo || analyzedPoints.length === 0) return;

    setIsGeneratingVideo(true);
    setVideoGenerationProgress(0);
    setError(null);
    addLog("Generating timelapse video... This can take some time depending on the number of points.");
    try {
        await generateTimelapseVideo(analyzedPoints, samplingDistance, streetName, reverseDirection, (progress) => {
            setVideoGenerationProgress(progress);
        }, country);
        addLog("Timelapse video generated and download started.");
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown video generation error";
        addLog(`Error generating video: ${message}`);
        setError(`Failed to generate timelapse video: ${message}`);
    } finally {
        setIsGeneratingVideo(false);
    }
  };


  const handleAnalyzeClick = useCallback(async () => {
    if (!apiKey) {
        setError("A Google API Key is required to perform the analysis. Please provide one in the settings.");
        addLog("Analysis halted: Missing Google API Key.");
        return;
    }

    if (!streetName || !cityName || !provinceState) {
        setError("Please select a country, province/state, and enter a city and street name.");
        addLog("Analysis halted: Missing location information.");
        return;
    }
      
    isCancelledRef.current = false;
    setIsLoading(true);
    setAnalyzedPoints([]);
    setSelectedPointIndex(null);
    setError(null);
    setIsKeyInvalid(false);
    setProgress(0);
    setTotalPointsToAnalyze(0);
    setLogs([`Analysis started for ${streetName} in ${cityName}, ${provinceState}: Offset=${startOffset}km, Distance=${samplingDistance}m, Max Points=${maxPoints}`]);

    try {
      addLog(`Checking for OpenStreetMap data for ${streetName} in ${cityName}, ${provinceState}...`);
      const { data: highwayPath, fromCache } = await fetchStreetData(streetName, cityName, provinceState);
      
      if (fromCache) {
          addLog(`Loaded OSM data for ${streetName}, ${cityName}, ${provinceState} from local cache (valid for 24 hours).`);
      } else {
          addLog("Fetched fresh OSM data from Overpass API.");
      }

      if (reverseDirection) {
        highwayPath.reverse();
        addLog("Path direction has been reversed by user for analysis.");
      }

       if (highwayPath.length === 0) {
        throw new Error(`No valid street segments found for "${streetName}" in "${cityName}, ${provinceState}" on OpenStreetMap. Please check spelling and try again.`);
      }
      addLog(`Full street path loaded with ${highwayPath.length} points.`);
      
      const samplingDistanceKm = samplingDistance / 1000;
      let pointsToAnalyze = getSamplePoints(highwayPath, samplingDistanceKm, startOffset);
       if (startOffset > 0 && pointsToAnalyze.length > 0) {
          addLog(`Skipped first ${startOffset}km of the route.`);
      }
      
      if (pointsToAnalyze.length > maxPoints) {
        addLog(`Capping analysis to the first ${maxPoints} of ${pointsToAnalyze.length} potential sample points.`);
        pointsToAnalyze = pointsToAnalyze.slice(0, maxPoints);
      }

      if (pointsToAnalyze.length === 0) {
        addLog(`No sample points generated with the current settings. Try a smaller offset or distance.`);
        setIsLoading(false);
        return;
      }
      
      setTotalPointsToAnalyze(pointsToAnalyze.length);
      addLog(`Generated ${pointsToAnalyze.length} sample points. Starting parallel analysis with concurrency level ${concurrency}...`);
      
      const results: (AnalyzedPoint | null)[] = new Array(pointsToAnalyze.length).fill(null);
      const queue = [...pointsToAnalyze.entries()];

      const worker = async () => {
        while (true) {
            if (isCancelledRef.current) break;
            const next = queue.shift();
            if (!next) break;

            const [index, point] = next;
            
            let imageUrl: string = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='; // Placeholder
            let imageDate: string | null = null;
            let forwardHeading = 0;
            if (index < pointsToAnalyze.length - 1) {
              forwardHeading = calculateBearing(point, pointsToAnalyze[index + 1]);
            } else if (index > 0) {
              forwardHeading = calculateBearing(pointsToAnalyze[index - 1], point);
            }
            const offsetPoint = offsetLocation(point.lat, point.lon, (forwardHeading + 90) % 360, 4);
            let newPoint: AnalyzedPoint | null = null;
            
            try {
                addLog(`[${index + 1}/${pointsToAnalyze.length}] Requesting image & metadata for point near ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`);
                
                const [imageResult, metadataResult] = await Promise.all([
                    getStreetViewImage(offsetPoint.lat, offsetPoint.lon, forwardHeading, apiKey),
                    getStreetViewMetadata(offsetPoint.lat, offsetPoint.lon, apiKey)
                ]);

                if (imageResult.success === false) {
                    throw new Error(imageResult.error);
                }

                if (metadataResult.success === false) {
                    addLog(`[${index + 1}/${pointsToAnalyze.length}] WARNING: Could not get image date. ${metadataResult.error}`);
                } else {
                    imageDate = metadataResult.date;
                }
                
                imageUrl = `data:image/jpeg;base64,${imageResult.base64}`;
              
                addLog(`[${index + 1}/${pointsToAnalyze.length}] Analyzing image with Gemini...`);
                const analysisResult = await analyzeSpeedSign(imageResult.base64, apiKey);

                let detectedSpeed = analysisResult?.speed_limit;
                const confidence = analysisResult?.confidence ?? null;

                if (detectedSpeed !== null && confidence !== null && confidence < confidenceThreshold) {
                    addLog(`[${index + 1}/${pointsToAnalyze.length}] Gemini confidence ${confidence.toFixed(2)} is below threshold ${confidenceThreshold}, discarding detected speed.`);
                    detectedSpeed = null;
                }
                
                // Country-specific validation for plausible speed limits.
                const minSpeed = country === 'USA' ? 5 : 10;
                const maxSpeed = country === 'USA' ? 90 : 150;
                const finalDetectedSpeed = (detectedSpeed !== null && detectedSpeed >= minSpeed && detectedSpeed <= maxSpeed) ? detectedSpeed : null;

                let isDiscrepancy = false;
                const hasOsmSpeed = point.speed !== null;
                const hasDetectedSpeed = finalDetectedSpeed !== null;

                if (hasOsmSpeed && hasDetectedSpeed) {
                    // Both OSM and detected speeds exist. This is a potential match or a value mismatch.
                    const osmSpeedMatch = point.speed!.match(/(\d+)/);
                    if (osmSpeedMatch) {
                        const osmSpeedValue = parseInt(osmSpeedMatch[0], 10);
                        const osmSpeedInKmh = point.speed!.toLowerCase().includes('mph')
                            ? osmSpeedValue * 1.60934
                            : osmSpeedValue;
                        const detectedSpeedInKmh = country === 'USA'
                            ? finalDetectedSpeed * 1.60934
                            : finalDetectedSpeed;

                        // Compare with a tolerance of 5 km/h to account for rounding (e.g., 50 mph ≈ 80 km/h)
                        if (Math.abs(osmSpeedInKmh - detectedSpeedInKmh) > 5) {
                            isDiscrepancy = true; // Value mismatch
                        }
                    } else {
                        // OSM speed is non-numeric (e.g., "signals"), but a sign was detected.
                        isDiscrepancy = true; 
                    }
                } else if (!hasOsmSpeed && hasDetectedSpeed) {
                    // A sign was detected, but there is no speed data in OSM. This is a discrepancy.
                    isDiscrepancy = true;
                }
                  
                if (isDiscrepancy) {
                  const speedUnit = country === 'USA' ? 'mph' : 'km/h';
                  addLog(`[${index + 1}/${pointsToAnalyze.length}] *** DISCREPANCY! OSM: ${point.speed}, Detected: ${finalDetectedSpeed} ${speedUnit}`);
                } else {
                  const speedUnit = country === 'USA' ? 'mph' : 'km/h';
                  addLog(`[${index + 1}/${pointsToAnalyze.length}] Finished. ${finalDetectedSpeed !== null ? `Detected speed ${finalDetectedSpeed} ${speedUnit}` : 'No actionable speed sign found.'}`);
                }
                
                newPoint = { id: `${point.lat}-${point.lon}`, location: point, osmSpeed: point.speed, detectedSpeed: finalDetectedSpeed, confidence, isDiscrepancy, imageUrl, heading: forwardHeading, wayId: point.wayId, imageDate };

            } catch (err) {
                 const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
                 addLog(`[${index + 1}/${pointsToAnalyze.length}] FAILED: ${errorMessage.substring(0, 150)}...`);
                 newPoint = {
                    id: `${point.lat}-${point.lon}`, location: point, osmSpeed: point.speed,
                    detectedSpeed: null, confidence: null, isDiscrepancy: false,
                    imageUrl: imageUrl,
                    heading: forwardHeading,
                    wayId: point.wayId,
                    imageDate: imageDate,
                };
                
                const lowerCaseError = errorMessage.toLowerCase();
                const isFatal = lowerCaseError.includes('api key') || lowerCaseError.includes('permission') || lowerCaseError.includes('403 forbidden');
                
                if (isFatal) {
                    addLog(`[${index + 1}/${pointsToAnalyze.length}] FATAL: Analysis stopping due to API key or permission error.`);
                    isCancelledRef.current = true;
                    throw err; // Re-throw fatal key errors to be caught by the main handler.
                }

                if (lowerCaseError.includes('quota')) {
                    addLog(`[${index + 1}/${pointsToAnalyze.length}] WARNING: API quota limit reached. This point will be marked as failed, but analysis will continue.`);
                }

            } finally {
                if (newPoint) {
                    results[index] = newPoint;
                }
                setProgress(p => p + 1);
            }
        }
      };

      const workers = Array.from({ length: concurrency }, () => worker());
      await Promise.allSettled(workers);
      
      const finalPoints = results.filter((p): p is AnalyzedPoint => p !== null);
      setAnalyzedPoints(finalPoints);

      if (isCancelledRef.current) {
        addLog("\nAnalysis stopped.");
      } else {
        addLog("\nAnalysis complete.");
        const discrepancyCount = finalPoints.filter(p => p.isDiscrepancy).length;
        if (discrepancyCount > 0) {
          addLog(`Found ${discrepancyCount} discrepancies.`);
        } else if (finalPoints.some(p => p.detectedSpeed !== null)) {
          addLog("No discrepancies found along the checked route.");
        }
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      const lowerCaseError = errorMessage.toLowerCase();

      if (
          lowerCaseError.includes('api key') ||
          lowerCaseError.includes('permission') ||
          lowerCaseError.includes('403 forbidden')
      ) {
          setIsKeyInvalid(true);
          const userFriendlyError = `The analysis was stopped because of an API key error. Please verify your key and ensure these APIs are enabled in your Google Cloud project: "Street View Static API", "Maps Static API", and "Vertex AI API".`;
          setError(userFriendlyError);
          addLog(`FATAL ERROR: ${userFriendlyError}`);
      } else {
        setError(errorMessage);
        addLog(`FATAL ERROR: ${errorMessage}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [samplingDistance, maxPoints, startOffset, apiKey, concurrency, confidenceThreshold, addLog, streetName, cityName, provinceState, reverseDirection, country]);

  const handleNextPoint = useCallback(() => {
    if (selectedPointIndex !== null && selectedPointIndex < analyzedPoints.length - 1) {
      setSelectedPointIndex(selectedPointIndex + 1);
    }
  }, [selectedPointIndex, analyzedPoints.length]);

  const handlePreviousPoint = useCallback(() => {
    if (selectedPointIndex !== null && selectedPointIndex > 0) {
      setSelectedPointIndex(selectedPointIndex - 1);
    }
  }, [selectedPointIndex]);


  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto p-4 md:p-8 flex-grow">
        <div className="max-w-5xl mx-auto">
          <div className="bg-brand-gray-800 p-6 rounded-lg shadow-xl mb-8">
            <h2 className="text-2xl font-bold mb-4">Speed Limit Verification Tool</h2>
            <p className="text-brand-gray-300 mb-6">
              This tool analyzes points along streets in Canada and the USA, comparing OpenStreetMap speed data with signs detected in Google Street View images by the Gemini model.
            </p>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                 <div>
                    <label htmlFor="country" className="block text-sm font-medium text-brand-gray-300 mb-2">Country</label>
                    <select
                        id="country"
                        value={country}
                        onChange={handleCountryChange}
                        disabled={isLoading}
                        className="w-full bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 text-white placeholder-brand-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue appearance-none pr-10"
                        style={selectStyle}
                    >
                        <option value="CAN">Canada</option>
                        <option value="USA">United States</option>
                    </select>
                </div>
                 <div>
                    <label htmlFor="province-state" className="block text-sm font-medium text-brand-gray-300 mb-2">Province / State</label>
                    <select
                        id="province-state"
                        value={provinceState}
                        onChange={(e) => setProvinceState(e.target.value)}
                        disabled={isLoading}
                        className="w-full bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 text-white placeholder-brand-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue appearance-none pr-10"
                        style={selectStyle}
                    >
                        {(country === 'USA' ? US_STATES : CANADIAN_PROVINCES).map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label htmlFor="city-name" className="block text-sm font-medium text-brand-gray-300 mb-2">City</label>
                    <input
                        type="text"
                        id="city-name"
                        value={cityName}
                        onChange={(e) => setCityName(e.target.value)}
                        disabled={isLoading}
                        placeholder="e.g., Toronto"
                        className="w-full bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 text-white placeholder-brand-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    />
                </div>
                <div>
                    <label htmlFor="street-name" className="block text-sm font-medium text-brand-gray-300 mb-2">Street Name</label>
                    <input
                        type="text"
                        id="street-name"
                        value={streetName}
                        onChange={(e) => setStreetName(e.target.value)}
                        disabled={isLoading}
                        placeholder="e.g., Yonge Street"
                        className="w-full bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 text-white placeholder-brand-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    />
                </div>
            </div>

            <div className="flex items-center my-4">
                <input
                    id="reverse-direction"
                    type="checkbox"
                    checked={reverseDirection}
                    onChange={(e) => setReverseDirection(e.target.checked)}
                    disabled={isLoading}
                    className="h-4 w-4 rounded border-gray-600 bg-brand-gray-900 text-brand-blue focus:ring-brand-blue focus:ring-offset-brand-gray-800"
                />
                <label htmlFor="reverse-direction" className="ml-3 block text-sm font-medium text-brand-gray-300">
                    Reverse Travel Direction (e.g., analyze South-to-North)
                </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mb-6">
                <div>
                  <label htmlFor="start-offset" className="block text-sm font-medium text-brand-gray-300 mb-2">Start Offset (km)</label>
                  <input
                      type="number" id="start-offset" value={startOffsetInput}
                      onChange={(e) => setStartOffsetInput(e.target.value)}
                      onBlur={() => {
                        let val = parseInt(startOffsetInput, 10) || 0;
                        setStartOffset(Math.max(0, val));
                      }}
                      disabled={isLoading}
                      className="w-full bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 text-white placeholder-brand-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                      min="0" step="1"
                  />
                </div>
                <div>
                  <label htmlFor="sampling-distance" className="block text-sm font-medium text-brand-gray-300 mb-2">Sampling Distance (m)</label>
                  <input
                      type="number" id="sampling-distance" value={samplingDistanceInput}
                      onChange={(e) => setSamplingDistanceInput(e.target.value)}
                      onBlur={() => {
                        let val = parseInt(samplingDistanceInput, 10) || 25;
                        setSamplingDistance(Math.max(25, val));
                      }}
                      disabled={isLoading}
                      className="w-full bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 text-white placeholder-brand-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                      min="25" step="5"
                  />
                </div>
                 <div>
                    <label htmlFor="max-points" className="block text-sm font-medium text-brand-gray-300 mb-2">Max Points</label>
                    <input
                        type="number" id="max-points" value={maxPointsInput}
                        onChange={(e) => setMaxPointsInput(e.target.value)}
                        onBlur={() => {
                            let val = parseInt(maxPointsInput, 10) || 1;
                            setMaxPoints(Math.max(1, Math.min(1000, val)));
                        }}
                        disabled={isLoading}
                        className="w-full bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 text-white placeholder-brand-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                        min="1" max="1000" step="1"
                    />
                </div>
                 <div>
                    <label htmlFor="concurrency" className="block text-sm font-medium text-brand-gray-300 mb-2">Concurrency Level</label>
                    <input
                        type="number" id="concurrency" value={concurrencyInput}
                        onChange={(e) => setConcurrencyInput(e.target.value)}
                        onBlur={() => {
                            let val = parseInt(concurrencyInput, 10) || 1;
                            setConcurrency(Math.max(1, Math.min(20, val)));
                        }}
                        disabled={isLoading}
                        className="w-full bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 text-white placeholder-brand-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                        min="1" max="20" step="1"
                    />
                </div>
                <div>
                  <label htmlFor="confidence-threshold" className="block text-sm font-medium text-brand-gray-300 mb-2">Gemini Confidence</label>
                  <input
                      type="number" id="confidence-threshold" value={confidenceThresholdInput}
                      onChange={(e) => setConfidenceThresholdInput(e.target.value)}
                      onBlur={() => {
                        let val = parseFloat(confidenceThresholdInput);
                        if (isNaN(val)) val = 0.3;
                        setConfidenceThreshold(Math.max(0, Math.min(1, val)));
                      }}
                      disabled={isLoading}
                      className="w-full bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 text-white placeholder-brand-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                      min="0" max="1" step="0.05"
                  />
                </div>
                <div>
                   <label id="cost-estimator-label" className="block text-sm font-medium text-brand-gray-300 mb-2">Estimated Cost</label>
                   <CostEstimator maxPoints={maxPoints} />
                </div>
            </div>

             <div className="mb-6">
                <label htmlFor="google-api-key" className="block text-sm font-medium text-brand-gray-300 mb-2">Google API Key <span className="text-red-400 font-bold">(Required)</span></label>
                <input
                    type="password" id="google-api-key" value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={isLoading}
                    placeholder="Enter your key for Street View, Maps & Gemini"
                    required
                    className="w-full bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 text-white placeholder-brand-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                />
                <p className="mt-2 text-sm text-brand-gray-400">
                    Ensure your key is enabled for the "Street View Static API", "Maps Static API", and "Vertex AI API".
                    <button 
                        onClick={() => setIsInstructionsModalOpen(true)}
                        className="ml-2 text-brand-blue hover:underline focus:outline-none font-semibold"
                    >
                        (How do I get a key?)
                    </button>
                </p>
            </div>
            
            <div className="space-y-4">
              {isLoading ? (
                  <button
                  onClick={handleStopClick}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 flex items-center justify-center text-lg"
                >
                  Stop Analysis
                </button>
              ) : (
                  <button
                  onClick={handleAnalyzeClick}
                  disabled={isLoading || !apiKey || !streetName || !cityName}
                  className="w-full bg-brand-blue hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 disabled:bg-brand-gray-600 disabled:cursor-not-allowed flex items-center justify-center text-lg"
                >
                  Analyze Street
                </button>
              )}
               {isLoading && totalPointsToAnalyze > 0 && (
                <div className="pt-2">
                  <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-brand-gray-300">Analysis Progress</span>
                      <span className="text-sm font-medium text-brand-gray-300">{progress} / {totalPointsToAnalyze} Points</span>
                  </div>
                  <div className="w-full bg-brand-gray-700 rounded-full h-2.5">
                    <div className="bg-brand-blue h-2.5 rounded-full transition-all duration-300 ease-linear" style={{ width: `${totalPointsToAnalyze > 0 ? (progress / totalPointsToAnalyze) * 100 : 0}%` }}></div>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
                <button
                    onClick={handleClearCache}
                    disabled={isLoading || !streetName || !cityName}
                    className="text-sm text-brand-gray-400 hover:text-white hover:bg-brand-gray-700 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1 rounded-md transition-colors"
                >
                    Clear OSM Data Cache
                </button>
            </div>
          </div>
          
          {isKeyInvalid && (
            <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded-lg relative mb-6" role="alert">
              <strong className="font-bold">Google API Key Error!</strong>
              <span className="block sm:inline ml-1">The key is invalid or not enabled for the required APIs. Please check the error log below and verify your settings.</span>
            </div>
          )}
          
          {error && (
            <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded-lg relative mb-6" role="alert">
              <strong className="font-bold">Error: </strong>
              <span className="block sm:inline">{error}</span>
            </div>
          )}

          {(logs.length > 1) && (
            <div className="mb-8">
               <h3 className="text-xl font-semibold mb-3">Analysis Log</h3>
               <StatusLog logs={logs} />
            </div>
          )}
          
          {!isLoading && analyzedPoints.length > 0 && (
            <div className="mb-8">
                <div className="flex flex-wrap items-center justify-between mb-4 gap-4">
                  <div>
                    <h3 className="text-2xl font-bold">
                        Analysis Results ({analyzedPoints.length} Points Checked)
                    </h3>
                    <p className="text-base font-normal text-brand-gray-400">
                        {analyzedPoints.filter(p => p.isDiscrepancy).length} discrepancies found. Click a thumbnail for details.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={handleDownloadPdf} 
                      disabled={isGeneratingPdf || isGeneratingVideo}
                      className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200 disabled:bg-brand-gray-600 disabled:cursor-wait"
                    >
                      {isGeneratingPdf ? 'Generating...' : 'Download PDF'}
                    </button>
                    <button
                        onClick={handleDownloadVideo}
                        disabled={isGeneratingVideo || isGeneratingPdf || analyzedPoints.length === 0}
                        className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200 disabled:bg-brand-gray-600 disabled:cursor-wait"
                    >
                        {isGeneratingVideo ? 'Generating Video...' : 'Download Timelapse'}
                    </button>
                    <button 
                      onClick={handleClearResults}
                      disabled={isGeneratingPdf || isGeneratingVideo}
                      className="bg-brand-gray-600 hover:bg-brand-gray-500 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200"
                    >
                      Clear Results
                    </button>
                  </div>
                </div>

                {isGeneratingVideo && (
                    <div className="mt-4">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-medium text-brand-gray-300">Video Generation Progress</span>
                            <span className="text-sm font-medium text-brand-gray-300">{Math.round(videoGenerationProgress * 100)}%</span>
                        </div>
                        <div className="w-full bg-brand-gray-700 rounded-full h-2.5">
                            <div className="bg-purple-600 h-2.5 rounded-full transition-all duration-300 ease-linear" style={{ width: `${videoGenerationProgress * 100}%` }}></div>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {analyzedPoints.map((point, index) => {
                        const getBorderColor = () => {
                            if (point.isDiscrepancy) return 'border-yellow-500 hover:border-yellow-400';
                            if (point.detectedSpeed !== null) return 'border-green-500 hover:border-green-400';
                            return 'border-brand-gray-600 hover:border-brand-blue';
                        };

                        const getBadge = () => {
                            if (point.isDiscrepancy) return <span className="bg-yellow-500 text-black px-2 py-1 rounded-md text-xs font-bold shadow-md">DISCREPANCY</span>;
                            if (point.detectedSpeed !== null) return <span className="bg-green-600 text-white px-2 py-1 rounded-md text-xs font-bold shadow-md">MATCH</span>;
                            return <span className="bg-black/50 text-white px-2 py-1 rounded-md text-xs font-bold shadow-md">NO SIGN</span>;
                        };
                        
                        const imageUrl = point.imageUrl.startsWith('data:image/') ? point.imageUrl : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

                        return (
                            <div 
                                key={point.id} 
                                onClick={() => setSelectedPointIndex(index)}
                                className={`relative cursor-pointer group bg-brand-gray-900 rounded-lg overflow-hidden border-4 ${getBorderColor()} transition-all duration-200 shadow-lg`}
                                role="button"
                                tabIndex={0}
                                onKeyPress={(e) => e.key === 'Enter' && setSelectedPointIndex(index)}
                                aria-label={`View details for location ${point.location.lat.toFixed(5)}, ${point.location.lon.toFixed(5)}`}
                            >
                                <img src={imageUrl} alt={`Street View at ${point.location.lat}, ${point.location.lon}`} className="w-full h-32 object-cover group-hover:scale-105 group-hover:opacity-80 transition-transform duration-300 bg-brand-gray-700" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-center p-2">
                                    {getBadge()}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
          )}

          {!isLoading && !error && logs.length > 1 && analyzedPoints.length > 0 && analyzedPoints.filter(p=>p.isDiscrepancy).length === 0 && !isKeyInvalid && (
             <div className="text-center p-8 bg-brand-gray-800 rounded-lg">
                <h3 className="text-2xl font-bold text-green-400">Analysis Complete</h3>
                <p className="text-brand-gray-300 mt-2">No discrepancies were found between OSM data and visible street signs for the sampled points.</p>
             </div>
          )}

          {!isLoading && !error && logs.length > 1 && analyzedPoints.length > 0 && !analyzedPoints.some(p => p.detectedSpeed !== null) && !isCancelledRef.current && (
             <div className="text-center p-8 bg-brand-gray-800 rounded-lg">
                <h3 className="text-2xl font-bold text-brand-gray-300">Analysis Complete</h3>
                <p className="text-brand-gray-300 mt-2">Could not detect any speed signs for the sampled points. This could be due to no signs being present, or issues with image quality. Try adjusting the sampling distance.</p>
             </div>
          )}

          {selectedPointIndex !== null && (
            <ResultDetailModal 
              point={analyzedPoints[selectedPointIndex]}
              onClose={() => setSelectedPointIndex(null)}
              onNext={handleNextPoint}
              onPrevious={handlePreviousPoint}
              hasNext={selectedPointIndex < analyzedPoints.length - 1}
              hasPrevious={selectedPointIndex > 0}
              country={country}
            />
          )}

          <ApiKeyInstructionsModal
            isOpen={isInstructionsModalOpen}
            onClose={() => setIsInstructionsModalOpen(false)}
          />
        </div>
      </main>
    </div>
  );
};

export default App;