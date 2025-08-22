
import type { AnalyzedPoint } from '../types';

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(new Error(`Failed to load image from data URL. ${err.toString()}`));
        img.src = src;
    });
}

export async function generateTimelapseVideo(
    points: AnalyzedPoint[],
    samplingDistance: number,
    streetName: string,
    isReversed: boolean,
    onProgress: (progress: number) => void,
    country: string
): Promise<void> {
    const validPoints = points.filter(p => p.imageUrl.startsWith('data:image/'));
    if (validPoints.length === 0) {
        throw new Error("No valid images available to generate a video.");
    }

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Failed to create canvas context.');
    }

    const mimeType = 'video/mp4; codecs=avc1.42E01E';
    const fallbackMimeType = 'video/webm; codecs=vp8';
    const selectedMimeType = MediaRecorder.isTypeSupported(mimeType) ? mimeType : fallbackMimeType;
    const fileExtension = selectedMimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    
    if (!MediaRecorder.isTypeSupported(selectedMimeType)) {
      throw new Error('Video recording (MP4/WebM) is not supported by this browser. Please try the latest version of Chrome or Firefox.');
    }
    
    const stream = canvas.captureStream(2); // 2 FPS
    const recorder = new MediaRecorder(stream, { 
        mimeType: selectedMimeType,
        bitsPerSecond: 8000000, // 8 Mbps bitrate for significantly better quality
    });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            chunks.push(event.data);
        }
    };
    
    const recorderStopped = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = (event) => reject((event as any).error || new Error("MediaRecorder error"));
    });

    recorder.start();

    try {
        const isUS = country === 'USA';
        const speedUnit = isUS ? 'mph' : 'km/h';

        const formatOsmSpeed = (speed: string | null): string => {
            if (!speed) return 'N/A';
            if (/\s(mph|kmh|km\/h)/i.test(speed)) {
                return speed;
            }
            if (/^\d+$/.test(speed)) {
                return `${speed} ${speedUnit}`;
            }
            return speed;
        };

        for (const [index, point] of validPoints.entries()) {
            const img = await loadImage(point.imageUrl);

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const padding = 10;
            const lineHeight = 18;
            
            // --- Top Two-Row Watermark Banner ---
            ctx.save();
            const watermarkBarHeight = (lineHeight * 2) + (padding * 1.5);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(0, 0, canvas.width, watermarkBarHeight);
            
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            // Top Row: Street Name & Direction
            const directionText = isReversed ? "Reversed" : "Forwards";
            const topRowText = `${streetName} | Direction: ${directionText}`;
            ctx.font = 'bold 16px Arial';
            ctx.fillText(topRowText, canvas.width / 2, padding / 2);

            // Bottom Row: Location & Distance
            const totalDistanceMeters = index * samplingDistance;
            let distanceString: string;
            if (isUS) {
                const distanceInMiles = totalDistanceMeters * 0.000621371;
                distanceString = `Distance: ${distanceInMiles.toFixed(2)} miles`;
            } else {
                const distanceInKm = totalDistanceMeters / 1000;
                distanceString = `Distance: ${distanceInKm.toFixed(2)} km`;
            }
            const bottomRowText = `Lat: ${point.location.lat.toFixed(5)}, Lon: ${point.location.lon.toFixed(5)} | ${distanceString}`;
            ctx.font = '15px Arial';
            ctx.fillText(bottomRowText, canvas.width / 2, (padding / 2) + lineHeight);
            ctx.restore();


            // --- Status Badge ---
            ctx.save();
            let badgeText: string;
            let badgeBgColor: string;
            let badgeTextColor: string;

            if (point.isDiscrepancy) {
                badgeText = 'DISCREPANCY';
                badgeBgColor = '#facc15'; // Tailwind yellow-400
                badgeTextColor = '#000000';
            } else if (point.detectedSpeed !== null) {
                badgeText = 'MATCH';
                badgeBgColor = '#22c55e'; // Tailwind green-500
                badgeTextColor = '#ffffff';
            } else {
                badgeText = 'NO SIGN';
                badgeBgColor = 'rgba(40, 40, 40, 0.7)';
                badgeTextColor = '#ffffff';
            }

            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            const badgeTextMetrics = ctx.measureText(badgeText);
            const badgeWidth = badgeTextMetrics.width + 16;
            const badgeHeight = 24;
            const badgeX = canvas.width - padding;
            const badgeY = watermarkBarHeight + padding;

            ctx.fillStyle = badgeBgColor;
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(badgeX - badgeWidth, badgeY, badgeWidth, badgeHeight, 6);
                ctx.fill();
            } else {
                ctx.fillRect(badgeX - badgeWidth, badgeY, badgeWidth, badgeHeight);
            }

            ctx.fillStyle = badgeTextColor;
            const textY = badgeY + (badgeHeight - 14) / 2; // Vertically center 14px font in 24px box
            ctx.fillText(badgeText, badgeX - (padding / 2), textY);
            ctx.restore();

            // --- Speed Info Box (Bottom Left) ---
            ctx.save();
            const speedBoxWidth = 200;
            const speedBoxHeight = 55;
            const speedBoxX = padding;
            const speedBoxY = canvas.height - speedBoxHeight - padding;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(speedBoxX, speedBoxY, speedBoxWidth, speedBoxHeight, 6);
                ctx.fill();
            } else {
                ctx.fillRect(speedBoxX, speedBoxY, speedBoxWidth, speedBoxHeight);
            }

            ctx.fillStyle = 'white';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.font = 'bold 16px Arial';
            
            const formattedOsm = formatOsmSpeed(point.osmSpeed);
            const osmText = `OSM: ${formattedOsm}`;
            const detectedText = `Detected: ${point.detectedSpeed !== null ? `${point.detectedSpeed} ${speedUnit}` : 'N/A'}`;

            ctx.fillText(osmText, speedBoxX + padding, speedBoxY + padding / 2 + 4);
            ctx.fillText(detectedText, speedBoxX + padding, speedBoxY + padding / 2 + lineHeight + 8);
            ctx.restore();
            
            await new Promise(resolve => setTimeout(resolve, 500)); // 1000ms / 2 FPS = 500ms per frame

            onProgress((index + 1) / validPoints.length);
        }
    } finally {
        if (recorder.state !== 'inactive') {
            recorder.stop();
        }
        await recorderStopped;
    }

    if (chunks.length === 0) {
        throw new Error("Video encoding failed: no data was recorded.");
    }
    
    const videoBlob = new Blob(chunks, { type: selectedMimeType });
    const url = URL.createObjectURL(videoBlob);
    
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `osm-speed-audit-timelapse.${fileExtension}`;
    
    document.body.appendChild(a);
    a.click();
    
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}