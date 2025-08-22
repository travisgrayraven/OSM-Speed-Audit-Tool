import { GoogleGenAI, Type } from "@google/genai";
import type { GeminiAnalysisResult } from '../types';

const geminiPrompt = `
Analyze this image from Google Street View. Your task is to identify any official, regulatory speed limit signs for road traffic.
- This includes both conventional signs (e.g., official North American rectangular white signs with black numbers) and speed limits painted directly on the road surface (e.g., "MAX 30").
- The sign or road marking must be clearly legible.
- IMPORTANT: If no sign or road marking is visible, if one is present but unreadable, or if you are uncertain, you MUST return null for the speed_limit. Do not guess or invent a number.
- The detected speed limit should be the raw numerical value from the sign.
`;

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        speed_limit: {
            type: Type.INTEGER,
            description: "The numerical speed limit value detected on the sign. For example, if the sign says 'SPEED LIMIT 55', return 55. Set to null if no clear sign is found.",
        },
        confidence: {
            type: Type.NUMBER,
            description: "A confidence score from 0.0 to 1.0 for the detected speed limit. If no sign is found, this should be low."
        }
    },
    required: ["speed_limit", "confidence"],
};

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

export async function analyzeSpeedSign(base64Image: string, userApiKey: string): Promise<GeminiAnalysisResult | null> {
    if (!userApiKey) {
        throw new Error("A Google API key must be provided in the UI.");
    }
    
    const ai = new GoogleGenAI({ apiKey: userApiKey });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const imagePart = {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image,
                },
            };

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [imagePart, { text: geminiPrompt }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema,
                }
            });

            const jsonString = response.text.trim();
            if (!jsonString) {
                console.warn("Gemini returned an empty response.");
                return null;
            }

            const result = JSON.parse(jsonString);

            if (typeof result.confidence !== 'number') {
                throw new Error("Invalid confidence type in response");
            }
            
            if (result.speed_limit !== null && typeof result.speed_limit !== 'number') {
                 throw new Error("Invalid speed_limit type in response");
            }

            return {
                speed_limit: result.speed_limit,
                confidence: result.confidence
            } as GeminiAnalysisResult;

        } catch (error) {
            console.error(`Gemini analysis attempt ${attempt + 1} failed:`, error);
            
            let errorMessage = 'An unknown Gemini API error occurred.';
            let errorStatus = '';

            if (typeof error === 'object' && error !== null) {
                const apiError = (error as any)?.error;
                if (apiError) {
                    if (apiError.message) errorMessage = apiError.message;
                    if (apiError.status) errorStatus = apiError.status;
                } else if ((error as Error).message) {
                    errorMessage = (error as Error).message;
                } else {
                    try {
                        errorMessage = JSON.stringify(error);
                    } catch { /* ignore */ }
                }
            } else {
                errorMessage = String(error);
            }
            
            const lowerCaseError = errorMessage.toLowerCase();
            const isQuotaError = lowerCaseError.includes('quota') || errorStatus === 'RESOURCE_EXHAUSTED';

            if (isQuotaError && attempt < MAX_RETRIES - 1) {
                const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
                console.log(`Quota limit hit. Retrying in ${backoffTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                continue; // Retry the loop
            }

            if (lowerCaseError.includes('api key not valid') || lowerCaseError.includes('permission denied')) {
                throw new Error(`The provided Google API key appears to be invalid or lacks permissions for the Vertex AI API.`);
            }

            if (isQuotaError) {
                throw new Error(`Failed to call the Gemini API after ${MAX_RETRIES} attempts due to quota limits. Please check your plan and billing details.`);
            }

            throw new Error(`Gemini analysis failed: ${errorMessage}`);
        }
    }

    return null; // Should not be reached if loop always throws on final error
}