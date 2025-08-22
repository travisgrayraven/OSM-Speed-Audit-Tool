
import React, { useState } from 'react';

// Pricing as of Q3 2024, for estimation purposes only.
// See https://cloud.google.com/maps-platform/pricing & https://ai.google.dev/pricing
const STREET_VIEW_STATIC_COST_PER_1000 = 7.00; // $7.00 per 1000
const GEMINI_FLASH_IMAGE_COST_PER_1000 = 0.125; // $0.000125/image for gemini-2.5-flash -> $0.125 per 1000
const MAPS_STATIC_COST_PER_1000 = 2.00; // $2.00 per 1000

const costPerStreetView = STREET_VIEW_STATIC_COST_PER_1000 / 1000;
const costPerGemini = GEMINI_FLASH_IMAGE_COST_PER_1000 / 1000;
const costPerMap = MAPS_STATIC_COST_PER_1000 / 1000;

interface CostEstimatorProps {
  maxPoints: number;
}

const CostEstimator: React.FC<CostEstimatorProps> = ({ maxPoints }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (maxPoints <= 0) {
    return (
      <div 
        aria-labelledby="cost-estimator-label"
        className="bg-brand-gray-900 border border-brand-gray-600 rounded-lg px-3 py-2 flex items-center justify-center"
      >
        <span className="text-brand-gray-500">N/A</span>
      </div>
    );
  }
  
  const numPoints = maxPoints;
  const streetViewCost = numPoints * costPerStreetView;
  const geminiCost = numPoints * costPerGemini;
  const analysisCost = streetViewCost + geminiCost;
  const pdfMapCost = costPerMap; // The overview map in the PDF is one API call.

  return (
    <div 
        aria-labelledby="cost-estimator-label"
        className={`px-3 py-2 bg-brand-gray-900 border border-brand-gray-600 rounded-lg flex flex-col transition-all duration-200 ${isExpanded ? 'justify-start' : 'justify-center'}`}
    >
      {!isExpanded ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-white">${analysisCost.toFixed(3)}</span>
          <button onClick={() => setIsExpanded(true)} className="text-xs text-brand-blue hover:underline whitespace-nowrap">Show Details</button>
        </div>
      ) : (
        <div>
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-bold text-brand-gray-200 text-xs">Cost Breakdown*</h4>
            <button onClick={() => setIsExpanded(false)} className="text-xs text-brand-blue hover:underline">Hide</button>
          </div>
          <ul className="space-y-1 text-brand-gray-300 text-xs">
            <li className="flex justify-between">
              <span>Street View ({numPoints}):</span>
              <span>${streetViewCost.toFixed(4)}</span>
            </li>
            <li className="flex justify-between">
              <span>Gemini Vision ({numPoints}):</span>
              <span>${geminiCost.toFixed(4)}</span>
            </li>
            <li className="flex justify-between font-bold border-t border-brand-gray-700 pt-1 mt-1">
              <span>Subtotal:</span>
              <span>${analysisCost.toFixed(4)}</span>
            </li>
          </ul>
          <p className="text-[10px] text-brand-gray-500 mt-2">
            *Excludes PDF map (~${pdfMapCost.toFixed(4)}), taxes, etc.
          </p>
        </div>
      )}
    </div>
  );
};

export default CostEstimator;
