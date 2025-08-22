
import { OVERPASS_API_URL } from '../constants';
import type { OSMPoint } from '../types';

// Cache configuration
const CACHE_KEY_PREFIX = 'osm_street_data_';
const CACHE_EXPIRY_HOURS = 24; // Cache for 24 hours
let memoryCache: { [key: string]: { data: OSMPoint[], timestamp: number } } = {};

// Internal interface for way data, including traffic direction.
interface OSMWay {
    id: number;
    nodes: number[];
    speed: string | null;
    oneway: string;
}

const MAX_OSM_RETRIES = 3;
const INITIAL_OSM_BACKOFF_MS = 2000;

const getCacheKey = (street: string, city: string, provinceState: string) => `${CACHE_KEY_PREFIX}${street.trim().toLowerCase().replace(/\s/g, '-')}_${city.trim().toLowerCase().replace(/\s/g, '-')}_${provinceState.trim().toLowerCase().replace(/\s/g, '-')}`;

/**
 * Generates a flexible regex string for a street name that includes common
 * abbreviations for both directional prefixes and street type suffixes.
 * e.g., "N State Pkwy" -> "N State Pkwy|North State Pkwy|N State Parkway|North State Parkway"
 * @param streetName The user-provided street name.
 * @returns A string suitable for an Overpass API regex query.
 */
function generateStreetNameRegex(streetName: string): string {
    const name = streetName.trim();
    const variations = new Set([name]);

    const directionalReplacements: { [key: string]: string } = {
        'North': 'N', 'South': 'S', 'East': 'E', 'West': 'W',
        'Northeast': 'NE', 'Northwest': 'NW', 'Southeast': 'SE', 'Southwest': 'SW'
    };

    const suffixReplacements: { [key: string]: string } = {
        'Street': 'St', 'Avenue': 'Ave', 'Boulevard': 'Blvd', 'Road': 'Rd',
        'Drive': 'Dr', 'Lane': 'Ln', 'Place': 'Pl', 'Court': 'Ct',
        'Circle': 'Cir', 'Crescent': 'Cres', 'Terrace': 'Terr', 'Trail': 'Trl',
        'Parkway': 'Pkwy', 'Square': 'Sq', 'Highway': 'Hwy', 'Expressway': 'Expy'
    };

    // First pass: generate all variations of directional prefixes.
    const prefixVariations = new Set(variations);
    for (const variation of variations) {
        for (const [long, short] of Object.entries(directionalReplacements)) {
            // Long to short (e.g., "North Main St" -> "N Main St")
            const longRegex = new RegExp(`^\\b${long}\\b`, 'i');
            if (variation.match(longRegex)) {
                prefixVariations.add(variation.replace(longRegex, short));
            }
            // Short to long (e.g., "N Main St" -> "North Main St")
            const shortRegex = new RegExp(`^\\b${short}\\b`, 'i');
            if (variation.match(shortRegex)) {
                prefixVariations.add(variation.replace(shortRegex, long));
            }
        }
    }

    // Second pass: for each prefix variation, generate all suffix variations.
    const finalVariations = new Set(prefixVariations);
    for (const variation of prefixVariations) {
        for (const [long, short] of Object.entries(suffixReplacements)) {
            // Long to short (e.g., "Main Street" -> "Main St")
            const longRegex = new RegExp(`\\b${long}\\b$`, 'i');
            if (variation.match(longRegex)) {
                finalVariations.add(variation.replace(longRegex, short));
            }
            // Short to long (e.g., "Main St" -> "Main Street")
            const shortRegex = new RegExp(`\\b${short}\\b$`, 'i');
            if (variation.match(shortRegex)) {
                finalVariations.add(variation.replace(shortRegex, long));
            }
        }
    }
    
    // Escape characters for regex and join with OR operator
    return Array.from(finalVariations).map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}


function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

function getCachedData(street: string, city: string, provinceState: string): OSMPoint[] | null {
  const cacheKey = getCacheKey(street, city, provinceState);

  // Check memory cache first
  if (memoryCache[cacheKey]) {
    const now = Date.now();
    const expiryTime = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
    if (now - memoryCache[cacheKey].timestamp < expiryTime) {
      return memoryCache[cacheKey].data;
    }
  }

  // Check localStorage as fallback
  try {
    const stored = localStorage.getItem(cacheKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      const now = Date.now();
      const expiryTime = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
      if (now - parsed.timestamp < expiryTime) {
        // Update memory cache
        memoryCache[cacheKey] = parsed;
        return parsed.data;
      }
    }
  } catch (error) {
    console.warn('Failed to read from localStorage cache:', error);
  }

  return null;
}

function setCachedData(data: OSMPoint[], street: string, city: string, provinceState: string): void {
  const cacheKey = getCacheKey(street, city, provinceState);
  const cacheEntry = {
    data,
    timestamp: Date.now()
  };

  // Update memory cache
  memoryCache[cacheKey] = cacheEntry;

  // Try to persist to localStorage
  try {
    localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
  } catch (error) {
    console.warn('Failed to save to localStorage cache:', error);
  }
}

export function clearOSMCache(street: string, city: string, provinceState: string): void {
    if (!street || !city || !provinceState) return;
  const cacheKey = getCacheKey(street, city, provinceState);
  delete memoryCache[cacheKey];
  try {
    localStorage.removeItem(cacheKey);
  } catch (error) {
    console.warn('Failed to clear localStorage cache:', error);
  }
  console.log(`OSM data cache cleared for ${street}, ${city}, ${provinceState}.`);
}

export async function fetchStreetData(street: string, city: string, provinceState: string): Promise<{data: OSMPoint[], fromCache: boolean}> {
  const cachedData = getCachedData(street, city, provinceState);
  if (cachedData) {
    console.log(`Using cached OSM data for ${street}, ${city}, ${provinceState}`);
    return { data: cachedData, fromCache: true };
  }
  
  const streetRegex = generateStreetNameRegex(street);

  const query = `
    [out:json][timeout:180];
    // Find an area that represents the state or province.
    // We search for a relation with a matching name and administrative boundary type.
    // This is generally more reliable for large areas like states.
    rel[name="${provinceState}"][boundary="administrative"];
    // Convert the found relation(s) to an area for spatial queries.
    map_to_area;
    
    // Find an area for the city *within* the state/province boundary.
    area(area)[name~"^${city}$",i]->.searchArea;
    
    // Find all ways with the specified name within that city area.
    // The regex now matches names that *start with* the street name, to include suffixes like SW, NE, etc.
    way(area.searchArea)["highway"]["name"~"^(${streetRegex})",i];

    // Recurse down to get all nodes for the ways found.
    (._;>;);
    out body;
    `;
    
  console.log(`Fetching fresh OSM data for ${street}, ${city}, ${provinceState} from API...`);

  for (let attempt = 0; attempt < MAX_OSM_RETRIES; attempt++) {
    if (attempt > 0) {
        const backoffTime = INITIAL_OSM_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.log(`Overpass API request failed. Retrying in ${backoffTime}ms... (Attempt ${attempt + 1}/${MAX_OSM_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
    }

    try {
        const response = await fetch(OVERPASS_API_URL, {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!response.ok) {
            if ([502, 503, 504].includes(response.status)) {
                // This is a temporary server error, so we throw to trigger a retry.
                throw new Error(`Overpass API is temporarily unavailable (status ${response.status}).`);
            }
            // For other errors (e.g., 400 Bad Request), we fail immediately.
            const errorBody = await response.text();
            throw new Error(`Overpass API query failed with status ${response.status}. Response: ${errorBody}`);
        }

        const data = await response.json();
      
        if (data.remark) {
            throw new Error(`Overpass API returned a notice: ${data.remark}`);
        }
        
        if (!data.elements || data.elements.length === 0) {
            return { data: [], fromCache: false };
        }

        const nodes: { [id: number]: { lat: number, lon: number } } = {};
        const ways: { [id: number]: OSMWay } = {};
        
        for (const el of data.elements) {
            if (el.type === 'node') {
            nodes[el.id] = { lat: el.lat, lon: el.lon };
            } else if (el.type === 'way') {
            ways[el.id] = { id: el.id, nodes: el.nodes, speed: el.tags?.maxspeed || null, oneway: el.tags?.oneway || 'no' };
            }
        }

        if (Object.keys(nodes).length === 0 || Object.keys(ways).length === 0) {
            return { data: [], fromCache: false };
        }

        const nodeToWayMap = new Map<number, number[]>();
        for (const wayIdStr in ways) {
            const way = ways[parseInt(wayIdStr, 10)];
            if (way.nodes.length > 0) {
            [way.nodes[0], way.nodes[way.nodes.length - 1]].forEach(nodeId => {
                if (!nodeToWayMap.has(nodeId)) nodeToWayMap.set(nodeId, []);
                nodeToWayMap.get(nodeId)!.push(way.id);
            });
            }
        }

        const chains: number[][] = [];
        const usedWays = new Set<number>();
        
        for (const wayIdStr in ways) {
            const wayId = parseInt(wayIdStr, 10);
            if (usedWays.has(wayId)) continue;
            
            let currentChain: number[] = [wayId];
            usedWays.add(wayId);
            
            // Extend forward
            let tip = ways[wayId].nodes[ways[wayId].nodes.length - 1];
            while(true) {
            const connections = nodeToWayMap.get(tip)?.filter(w => !usedWays.has(w));
            if (!connections || connections.length === 0) break;
            const nextWayId = connections[0];
            const nextWay = ways[nextWayId];
            usedWays.add(nextWayId);
            if (nextWay.nodes[0] === tip) {
                currentChain.push(nextWayId);
                tip = nextWay.nodes[nextWay.nodes.length - 1];
            } else { // connection is to the end, so we prepend it reversed
                currentChain.push(nextWayId);
                tip = nextWay.nodes[0];
            }
            }
            
            // Extend backward
            tip = ways[wayId].nodes[0];
            while(true) {
                const connections = nodeToWayMap.get(tip)?.filter(w => !usedWays.has(w));
                if (!connections || connections.length === 0) break;
                const nextWayId = connections[0];
                const nextWay = ways[nextWayId];
                usedWays.add(nextWayId);
                if (nextWay.nodes[nextWay.nodes.length - 1] === tip) {
                    currentChain.unshift(nextWayId);
                    tip = nextWay.nodes[0];
                } else {
                    currentChain.unshift(nextWayId);
                    tip = nextWay.nodes[nextWay.nodes.length - 1];
                }
            }

            chains.push(currentChain);
        }
        
        if (chains.length === 0) return { data: [], fromCache: false };
        
        chains.sort((a, b) => b.length - a.length);
        const longestChain = chains[0];
        
        const finalPath: OSMPoint[] = [];

        const buildPointsForWay = (wayId: number, nodeIds: number[]) => {
            const way = ways[wayId];
            return nodeIds.map(nodeId => {
                const node = nodes[nodeId];
                return node ? { ...node, speed: way.speed, wayId: way.id } : null;
            }).filter((p): p is OSMPoint => p !== null);
        };
        
        if (longestChain.length > 0) {
            const firstWayId = longestChain[0];
            finalPath.push(...buildPointsForWay(firstWayId, ways[firstWayId].nodes));

            for (let i = 1; i < longestChain.length; i++) {
                const currentWay = ways[longestChain[i]];
                const lastPointOfPath = finalPath[finalPath.length - 1];
                if (!lastPointOfPath) break;
                
                const startNodeOfCurrent = nodes[currentWay.nodes[0]];
                const endNodeOfCurrent = nodes[currentWay.nodes[currentWay.nodes.length - 1]];

                if (lastPointOfPath.lat === startNodeOfCurrent.lat && lastPointOfPath.lon === startNodeOfCurrent.lon) {
                    finalPath.push(...buildPointsForWay(currentWay.id, currentWay.nodes.slice(1)));
                } else if (lastPointOfPath.lat === endNodeOfCurrent.lat && lastPointOfPath.lon === endNodeOfCurrent.lon) {
                    finalPath.push(...buildPointsForWay(currentWay.id, [...currentWay.nodes].reverse().slice(1)));
                } else {
                    console.warn(`Path reconstruction warning: Discontinuity detected at way ${currentWay.id}. Appending as-is.`);
                    finalPath.push(...buildPointsForWay(currentWay.id, currentWay.nodes));
                }
            }
        }

        if (finalPath.length > 0) {
            const onewayWaysCount = longestChain.filter(wayId => {
                const way = ways[wayId];
                return way && (way.oneway === 'yes' || way.oneway === 'true' || way.oneway === '1');
            }).length;
            
            if (longestChain.length > 0 && (onewayWaysCount / longestChain.length) > 0.5) {
                console.log("Street appears to be one-way. Path direction will follow OSM data to respect traffic flow.");
            } else {
                const firstPoint = finalPath[0];
                const lastPoint = finalPath[finalPath.length - 1];
                const isNorthSouthDominant = Math.abs(lastPoint.lat - firstPoint.lat) > Math.abs(lastPoint.lon - firstPoint.lon);

                let needsReversing = false;
                if (isNorthSouthDominant) {
                    if (firstPoint.lat < lastPoint.lat) {
                        needsReversing = true;
                    }
                } else {
                    if (firstPoint.lon > lastPoint.lon) {
                        needsReversing = true;
                    }
                }

                if (needsReversing) {
                    finalPath.reverse();
                    console.log("Path direction reversed for traversal consistency (e.g., N->S or W->E).");
                }
            }
        }

        const sortedPath = finalPath;

        for (let i = 0; i < sortedPath.length; i++) {
            if (sortedPath[i].speed === null && i > 0) {
            sortedPath[i].speed = sortedPath[i-1].speed;
            sortedPath[i].wayId = sortedPath[i-1].wayId;
            }
        }

        setCachedData(sortedPath, street, city, provinceState);
        return { data: sortedPath, fromCache: false };

    } catch (error) {
        console.error(`Attempt ${attempt + 1} failed:`, error instanceof Error ? error.message : String(error));
        
        if (attempt === MAX_OSM_RETRIES - 1) {
            const finalErrorMsg = error instanceof Error ? error.message.toLowerCase() : '';
            if (finalErrorMsg.includes('temporarily unavailable') || finalErrorMsg.includes('status 504')) {
                throw new Error(`The OpenStreetMap server is busy or unavailable. After ${MAX_OSM_RETRIES} attempts, the request timed out. Please try again in a few minutes.`);
            }
            throw error;
        }
    }
  }

  // This should theoretically not be reached.
  throw new Error('Failed to fetch OpenStreetMap data after all retry attempts.');
}

// Linear interpolation of latitude and longitude. This is a good approximation for short distances.
function interpolate(p1: OSMPoint, p2: OSMPoint, fraction: number): { lat: number, lon: number } {
    const lat = p1.lat + (p2.lat - p1.lat) * fraction;
    const lon = p1.lon + (p2.lon - p1.lon) * fraction;
    return { lat, lon };
}

export function getSamplePoints(path: OSMPoint[], distanceKm: number, startOffsetKm: number): OSMPoint[] {
    if (path.length < 2 || distanceKm <= 0) {
        return [];
    }

    // 1. Calculate cumulative distances for the entire path
    const cumulativeDistances: number[] = [0];
    for (let i = 1; i < path.length; i++) {
        const segmentDistance = haversineDistance(
            path[i - 1].lat, path[i - 1].lon,
            path[i].lat, path[i].lon
        );
        cumulativeDistances.push(cumulativeDistances[i - 1] + segmentDistance);
    }

    const totalPathDistance = cumulativeDistances[cumulativeDistances.length - 1];
    if (startOffsetKm >= totalPathDistance && totalPathDistance > 0) {
        console.warn(`Start offset (${startOffsetKm}km) is greater than or equal to the total path length (${totalPathDistance.toFixed(2)}km). No points will be sampled.`);
        return []; // Offset is beyond the path length
    }

    const samplePoints: OSMPoint[] = [];
    let currentPathIndex = 1;

    // 2. Generate target distances for sampling, starting from the offset
    for (let targetDist = startOffsetKm; targetDist < totalPathDistance; targetDist += distanceKm) {
        if (targetDist < 0) continue; // Skip if somehow target distance is negative

        // 3. Find the segment of the path where the target distance falls
        // This loop finds the first node *after* our target distance
        while (currentPathIndex < path.length && cumulativeDistances[currentPathIndex] < targetDist) {
            currentPathIndex++;
        }

        // If we've gone past the end of the path, stop.
        if (currentPathIndex >= path.length) {
            break;
        }

        // 4. Interpolate the exact coordinates for the point within the located segment
        const p1 = path[currentPathIndex - 1]; // The node before our target distance
        const p2 = path[currentPathIndex];     // The node after our target distance

        const segmentStartDist = cumulativeDistances[currentPathIndex - 1];
        const segmentLength = cumulativeDistances[currentPathIndex] - segmentStartDist;

        // Avoid division by zero if two consecutive nodes are at the same location
        if (segmentLength === 0) {
            // Just use the first point of the zero-length segment and continue
            if (samplePoints.length === 0 || (samplePoints[samplePoints.length - 1].lat !== p1.lat && samplePoints[samplePoints.length - 1].lon !== p1.lon)) {
                samplePoints.push(p1);
            }
            continue;
        }

        const distanceIntoSegment = targetDist - segmentStartDist;
        const fraction = distanceIntoSegment / segmentLength;

        const interpolatedCoords = interpolate(p1, p2, fraction);
        
        // 5. Create a new sample point. We'll use the properties (speed, wayId) from the start of the segment.
        const newPoint: OSMPoint = {
            ...interpolatedCoords,
            speed: p1.speed,
            wayId: p1.wayId,
        };
        samplePoints.push(newPoint);
    }

    console.log(`Generated ${samplePoints.length} evenly spaced sample points using interpolation.`);
    
    return samplePoints;
}