
import jsPDF from 'jspdf';
import type { AnalyzedPoint } from '../types';

interface ImageFetchResult {
    success: boolean;
    dataUrl: string | null;
    error: string | null;
}

export interface ReportMetadata {
    cityName: string;
    streetName: string;
    provinceState: string;
    startOffset: number;
    samplingDistance: number;
    maxPoints: number;
    confidenceThreshold: number;
    country: string;
}


// Helper to fetch an image from a URL and convert it to a Base64 Data URL.
async function urlToDataUrl(url: string): Promise<ImageFetchResult> {
    try {
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) {
            const errorText = await response.text();
            const errorMessage = `Failed to fetch map image. Status: ${response.status}. Response from Google: ${errorText}`;
            console.error(errorMessage);
            return { success: false, dataUrl: null, error: 'Map API Error. Check key restrictions & enabled APIs in Google Cloud.' };
        }
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve({ success: true, dataUrl: reader.result as string, error: null });
            reader.onerror = () => {
                const errorMessage = "Internal error: Could not convert map image blob to Data URL.";
                console.error(errorMessage);
                resolve({ success: false, dataUrl: null, error: errorMessage });
            };
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        let errorMessage = "A network error occurred while fetching the map image. This may be a CORS issue. Check the browser's developer console for more details.";
        if (error instanceof Error) {
            errorMessage += ` Details: ${error.message}`;
        }
        console.error(errorMessage, error);
        return { success: false, dataUrl: null, error: "Network/CORS error. Check browser console." };
    }
}


export async function generatePdfReport(points: AnalyzedPoint[], apiKey: string, metadata: ReportMetadata): Promise<void> {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const discrepancyPoints = points.filter(p => p.isDiscrepancy);
    
    const isUS = metadata.country === 'USA';
    const speedUnit = isUS ? 'mph' : 'km/h';
    const distanceUnitLong = isUS ? 'miles' : 'km';

    // Helper function to format OSM speed for consistency
    const formatOsmSpeed = (speed: string | null, country: string): string => {
        const localSpeedUnit = country === 'USA' ? 'mph' : 'km/h';
        if (!speed) return 'N/A';
        // If units are already present (e.g., "50 mph"), return as is.
        if (/\s(mph|kmh|km\/h)/i.test(speed)) {
            return speed;
        }
        // If it's just a number, add the correct unit based on country.
        if (/^\d+$/.test(speed)) {
            return `${speed} ${localSpeedUnit}`;
        }
        // Otherwise, it's a non-standard value like "signals" or "zone", so return it as is.
        return speed;
    };
    
    // --- Title Page ---
    const titleY = 25; // Y position for the main title
    doc.setFontSize(22);
    doc.text('OSM Speed Auditor - Analysis Report', doc.internal.pageSize.getWidth() / 2, titleY, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, doc.internal.pageSize.getWidth() / 2, titleY + 7, { align: 'center' });
    
    // --- Parameters and Summary ---
    const leftColX = 14;
    const rightColX = 110;
    const sectionStartY = titleY + 25;

    // Parameters
    doc.setFontSize(16);
    doc.text('Analysis Parameters', leftColX, sectionStartY);
    doc.setFontSize(11);
    doc.text(`Location: ${metadata.cityName}, ${metadata.provinceState}`, leftColX, sectionStartY + 10);
    doc.text(`Street: ${metadata.streetName}`, leftColX, sectionStartY + 17);
    
    const startOffsetDisplay = isUS ? (metadata.startOffset * 0.621371).toFixed(2) : metadata.startOffset;
    doc.text(`Start Offset: ${startOffsetDisplay} ${distanceUnitLong}`, leftColX, sectionStartY + 24);

    const samplingDistanceDisplay = isUS ? Math.round(metadata.samplingDistance * 3.28084) : metadata.samplingDistance;
    const samplingUnitShort = isUS ? 'ft' : 'm';
    doc.text(`Sampling Distance: ${samplingDistanceDisplay} ${samplingUnitShort}`, leftColX, sectionStartY + 31);
    
    doc.text(`Max Points: ${metadata.maxPoints}`, leftColX, sectionStartY + 38);
    doc.text(`Gemini Confidence: >= ${metadata.confidenceThreshold}`, leftColX, sectionStartY + 45);

    // Summary
    const totalDistanceKm = (points.length * metadata.samplingDistance) / 1000;
    const totalDistanceDisplay = isUS ? (totalDistanceKm * 0.621371).toFixed(2) : totalDistanceKm.toFixed(2);
    doc.setFontSize(16);
    doc.text('Summary', rightColX, sectionStartY);
    doc.setFontSize(11);
    doc.text(`Total Points Analyzed: ${points.length}`, rightColX, sectionStartY + 10);
    doc.text(`Approx. Distance Analyzed: ${totalDistanceDisplay} ${distanceUnitLong}`, rightColX, sectionStartY + 17);
    doc.text(`Discrepancies Found: ${discrepancyPoints.length}`, rightColX, sectionStartY + 24);
    doc.text(`Matches Found: ${points.filter(p => !p.isDiscrepancy && p.detectedSpeed !== null).length}`, rightColX, sectionStartY + 31);
    doc.text(`Images with No Sign: ${points.filter(p => p.detectedSpeed === null).length}`, rightColX, sectionStartY + 38);


    // --- Overview Map on Title Page ---
    if (points.length > 0) {
        const mapSectionY = sectionStartY + 55;
        doc.setFontSize(16);
        doc.text('Sampled Route Overview', 14, mapSectionY);

        const MAX_MARKERS_ON_MAP = 75;
        
        const getMarkerColor = (p: AnalyzedPoint): string => {
            if (p.isDiscrepancy) return 'orange';
            if (p.detectedSpeed !== null) return 'green';
            return 'blue';
        };
        
        const markersForMap = points.slice(0, MAX_MARKERS_ON_MAP).map(p =>
            `markers=color:${getMarkerColor(p)}%7C${p.location.lat},${p.location.lon}`
        ).join('&');

        const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?size=640x480&${markersForMap}&maptype=roadmap&key=${apiKey}`;
        
        const mapFetchResult = await urlToDataUrl(mapUrl);
        const mapWidth = 180;
        const mapHeight = 100;
        const mapX = (doc.internal.pageSize.width - mapWidth) / 2;
        const mapY = mapSectionY + 10;

        if (mapFetchResult.success && mapFetchResult.dataUrl) {
            const imageType = mapFetchResult.dataUrl.split(';')[0].split('/')[1]?.toUpperCase() || 'PNG';
            doc.addImage(mapFetchResult.dataUrl, imageType, mapX, mapY, mapWidth, mapHeight);
        } else {
            doc.setFillColor(233, 236, 239);
            doc.rect(mapX, mapY, mapWidth, mapHeight, 'F');
            doc.setFontSize(10);
            doc.setTextColor(100, 0, 0);
            doc.text(mapFetchResult.error || 'Overview map could not be loaded.', doc.internal.pageSize.getWidth() / 2, mapY + mapHeight / 2, { align: 'center', maxWidth: mapWidth - 10 });
        }
        
        if (points.length > MAX_MARKERS_ON_MAP) {
            doc.setFontSize(8);
            doc.setTextColor(108, 117, 125);
            doc.text(`Note: Map displays the first ${MAX_MARKERS_ON_MAP} points.`, doc.internal.pageSize.getWidth() / 2, mapY + mapHeight + 5, { align: 'center' });
        }
    }
    
    // --- Detailed Grid Pages ---
    if (points.length === 0) {
        doc.save('osm-speed-audit-report.pdf');
        return;
    }

    const PAGE_MARGIN = 15;
    const GUTTER = 10;
    const PAGE_WIDTH = doc.internal.pageSize.width;
    
    const CELL_WIDTH = (PAGE_WIDTH - (2 * PAGE_MARGIN) - GUTTER) / 2;
    const IMAGE_ASPECT_RATIO = 4 / 3;
    const IMAGE_HEIGHT = 55;
    const IMAGE_WIDTH = IMAGE_HEIGHT * IMAGE_ASPECT_RATIO;
    const TEXT_AREA_HEIGHT = 22; // Reduced height to ensure 3 rows fit on page
    const CELL_HEIGHT = IMAGE_HEIGHT + TEXT_AREA_HEIGHT;
    const ITEMS_PER_PAGE = 6;

    for (const [index, point] of points.entries()) {
        const itemOnPage = index % ITEMS_PER_PAGE;

        if (itemOnPage === 0) {
            doc.addPage();
            doc.setFontSize(18);
            doc.setTextColor(0,0,0);
            doc.text('Detailed Analysis Grid', PAGE_MARGIN, 20);
        }

        const col = itemOnPage % 2;
        const row = Math.floor(itemOnPage / 2);

        const cellX = PAGE_MARGIN + col * (CELL_WIDTH + GUTTER);
        const cellY = 30 + row * (CELL_HEIGHT + GUTTER);
        const imageX = cellX + (CELL_WIDTH - IMAGE_WIDTH) / 2;

        if (point.imageUrl.startsWith('data:image/')) {
            const imageType = point.imageUrl.split(';')[0].split('/')[1]?.toUpperCase() || 'JPEG';
            doc.addImage(point.imageUrl, imageType, imageX, cellY, IMAGE_WIDTH, IMAGE_HEIGHT);
        } else {
            doc.setFillColor(233, 236, 239);
            doc.rect(imageX, cellY, IMAGE_WIDTH, IMAGE_HEIGHT, 'F');
            doc.setTextColor(108, 117, 125);
            doc.text('No Image', imageX + IMAGE_WIDTH / 2, cellY + IMAGE_HEIGHT / 2, { align: 'center' });
        }

        // --- Text Block ---
        const TEXT_START_Y_OFFSET = 5;
        const LINE_SPACING = 5;
        let textY = cellY + IMAGE_HEIGHT + TEXT_START_Y_OFFSET;

        // Status
        let status = 'No Sign';
        let statusColor: [number, number, number] = [108, 117, 125];
        if (point.isDiscrepancy) {
            status = 'Discrepancy';
            statusColor = [217, 119, 6];
        } else if (point.detectedSpeed !== null) {
            status = 'Match';
            statusColor = [22, 163, 74];
        }
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(...statusColor);
        doc.text(status, cellX, textY);

        // OSM and Detected Speed
        textY += LINE_SPACING;
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(0, 0, 0);
        
        const formattedOsm = formatOsmSpeed(point.osmSpeed, metadata.country);
        const osmText = `OSM: ${formattedOsm}`;
        
        let detectedText = `Detected: ${point.detectedSpeed !== null ? `${point.detectedSpeed} ${speedUnit}` : 'N/A'}`;
        if (point.detectedSpeed !== null && point.confidence !== null) {
            detectedText += ` (Conf: ${point.confidence.toFixed(2)})`;
        }
        doc.text(osmText, cellX, textY);
        doc.text(detectedText, cellX + CELL_WIDTH / 2.2, textY);

        // Metadata and Links block, starts further down
        let metadataY = textY + LINE_SPACING + 2;

        doc.setFontSize(8);
        doc.setTextColor(108, 117, 125);
        if (point.imageDate) {
            doc.text(`Image Date: ${point.imageDate}`, cellX, metadataY);
        }

        if (point.wayId) {
            const wayIdY = point.imageDate ? metadataY + 4 : metadataY;
            const wayIdText = `OSM Way ID: ${point.wayId}`;
            doc.setTextColor(108, 117, 125);
            doc.text(wayIdText, cellX, wayIdY);
            
            const textWidth = doc.getTextWidth(wayIdText);
            const linkMargin = 2;
            const editLink = `https://www.openstreetmap.org/edit?way=${point.wayId}`;
            doc.setTextColor(26, 115, 232);
            doc.textWithLink('Edit in OSM', cellX + textWidth + linkMargin, wayIdY, { url: editLink });
        }

        // Right aligned external links
        const mapLink = `https://www.google.com/maps/@${point.location.lat},${point.location.lon},20z`;
        const streetViewLink = `https://www.google.com/maps?q&layer=c&cbll=${point.location.lat},${point.location.lon}&cbp=12,${point.heading},0,0,5`;
        doc.setTextColor(26, 115, 232);
        doc.setFontSize(8);
        doc.textWithLink('Google Maps', cellX + CELL_WIDTH, metadataY, { url: mapLink, align: 'right' });
        doc.textWithLink('Street View', cellX + CELL_WIDTH, metadataY + 4, { url: streetViewLink, align: 'right' });
    }
    
    doc.save('osm-speed-audit-report.pdf');
}