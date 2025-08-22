import React from 'react';
import type { AnalyzedPoint } from '../types';

interface ResultDetailModalProps {
  point: AnalyzedPoint;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  hasNext: boolean;
  hasPrevious: boolean;
  country: string;
}

const ResultDetailModal: React.FC<ResultDetailModalProps> = ({ point, onClose, onNext, onPrevious, hasNext, hasPrevious, country }) => {
    const { location, osmSpeed, detectedSpeed, imageUrl, heading, isDiscrepancy, confidence, wayId, imageDate } = point;
    const mapLink = `https://www.google.com/maps/@${location.lat},${location.lon},20z?entry=ttu`;
    const streetViewLink = `https://www.google.com/maps?q&layer=c&cbll=${location.lat},${location.lon}&cbp=12,${heading},0,0,5`;
    const osmEditLink = wayId ? `https://www.openstreetmap.org/edit?way=${wayId}` : null;
    const speedUnit = country === 'USA' ? 'mph' : 'km/h';
    
    const getStatusInfo = () => {
        if (isDiscrepancy) {
            // Provide a more specific title based on the type of discrepancy.
            const title = (osmSpeed === null && detectedSpeed !== null) 
                ? "OSM Data Missing"
                : "Data Mismatch";

            return {
                title: title,
                color: "text-yellow-400",
                // A mismatch is an "error" in the data, so red feels appropriate for the detected value.
                detectedBg: "bg-red-600"
            };
        }
        if (detectedSpeed !== null) {
            return {
                title: "Speed Match",
                color: "text-green-400",
                detectedBg: "bg-green-600"
            };
        }
        return {
            title: "No Clear Sign Detected",
            color: "text-brand-gray-300",
            detectedBg: "bg-brand-gray-600"
        };
    };

    const status = getStatusInfo();
    
    // Format OSM speed to include units if they are missing
    const formatOsmSpeed = (speed: string | null): string => {
        if (!speed) return 'N/A';
        // If units are already present (e.g., "50 mph"), return as is.
        if (/\s(mph|kmh|km\/h)/i.test(speed)) {
            return speed;
        }
        // If it's just a number, add the correct unit based on country.
        if (/^\d+$/.test(speed)) {
            return `${speed} ${speedUnit}`;
        }
        // Otherwise, it's a non-standard value like "signals" or "zone", so return it as is.
        return speed;
    };

    const formattedOsmSpeed = formatOsmSpeed(osmSpeed);


    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            } else if (event.key === 'ArrowRight' && hasNext) {
                onNext();
            } else if (event.key === 'ArrowLeft' && hasPrevious) {
                onPrevious();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, onNext, onPrevious, hasNext, hasPrevious]);

    return (
        <div 
            className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in"
            onClick={onClose}
            aria-modal="true"
            role="dialog"
        >
            <style>{`
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .animate-fade-in { animation: fade-in 0.2s ease-out; }
            `}</style>
            
            {hasPrevious && (
                <button
                    onClick={(e) => { e.stopPropagation(); onPrevious(); }}
                    aria-label="Previous item"
                    className="absolute left-0 sm:left-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition-colors p-2 rounded-full bg-black/30 hover:bg-black/50 z-10"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 sm:h-12 sm:w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
            )}

            <div 
                className="bg-brand-gray-800 rounded-lg shadow-2xl overflow-hidden w-full max-w-4xl border-2 border-brand-gray-700 mx-auto max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()} // Prevent closing modal when clicking inside
            >
                <div className="relative">
                    <img src={imageUrl} alt={`Street View at ${location.lat}, ${location.lon}`} className="w-full h-auto max-h-[60vh] object-contain bg-black" />
                     <button onClick={onClose} aria-label="Close dialog" className="absolute top-2 right-3 text-white/70 bg-black/40 rounded-full hover:text-white text-4xl leading-none font-light w-10 h-10 flex items-center justify-center">&times;</button>
                </div>

                <div className="p-6 flex-grow overflow-y-auto">
                    <div className="grid md:grid-cols-2 gap-x-8 gap-y-6">
                        {/* Left Column: Analysis Details */}
                        <div>
                             <h3 className={`text-2xl font-bold ${status.color} mb-4`}>{status.title}</h3>
                            <div className="space-y-4 text-brand-gray-200">
                                <div className="flex justify-between items-center">
                                    <span className="font-semibold text-brand-gray-400">OSM Speed:</span>
                                    <span className="text-2xl font-bold text-white bg-blue-600 px-3 py-1 rounded">{formattedOsmSpeed}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="font-semibold text-brand-gray-400">Detected Speed:</span>
                                    <span className={`text-2xl font-bold text-white ${status.detectedBg} px-3 py-1 rounded`}>{detectedSpeed !== null ? `${detectedSpeed} ${speedUnit}` : 'N/A'}</span>
                                </div>
                                {confidence !== null && (
                                    <p className="text-sm text-brand-gray-400 pt-2">
                                        Gemini Confidence: {confidence.toFixed(2)}
                                    </p>
                                )}
                                 <p className="text-sm text-brand-gray-400">Image taken facing heading: {Math.round(heading)}°</p>
                                 {imageDate && (<p className="text-sm text-brand-gray-400">Image Date: {imageDate}</p>)}
                                 {wayId && (<p className="text-sm text-brand-gray-400">OSM Way ID: {wayId}</p>)}
                            </div>
                        </div>

                        {/* Right Column: External Links */}
                        <div className="pt-2">
                             <h4 className="text-lg font-semibold text-brand-gray-200 mb-3">External Links</h4>
                             <div className="space-y-3">
                                <a 
                                href={mapLink} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="block w-full text-center bg-brand-blue/80 hover:bg-brand-blue text-white font-bold py-3 px-4 rounded transition-colors duration-200"
                                >
                                View on Google Maps
                                </a>
                                <a 
                                href={streetViewLink} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="block w-full text-center bg-brand-gray-600 hover:bg-brand-gray-500 text-white font-bold py-3 px-4 rounded transition-colors duration-200"
                                >
                                View on Google Street View
                                </a>
                                {osmEditLink && (
                                     <a 
                                        href={osmEditLink} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="block w-full text-center bg-orange-600 hover:bg-orange-500 text-white font-bold py-3 px-4 rounded transition-colors duration-200"
                                     >
                                     Edit on OpenStreetMap
                                     </a>
                                )}
                             </div>
                        </div>
                    </div>
                </div>

            </div>

            {hasNext && (
                <button
                    onClick={(e) => { e.stopPropagation(); onNext(); }}
                    aria-label="Next item"
                    className="absolute right-0 sm:right-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition-colors p-2 rounded-full bg-black/30 hover:bg-black/50 z-10"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 sm:h-12 sm:w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            )}

        </div>
    );
};

export default ResultDetailModal;