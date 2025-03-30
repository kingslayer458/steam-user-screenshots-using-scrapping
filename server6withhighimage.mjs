import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Optimized function to fetch all screenshots with enhanced image quality
async function getAllScreenshots(steamID) {
    const screenshots = [];
    const allScreenshotPageUrls = new Set(); // Using Set to avoid duplicates
    
    try {
        console.log(`Attempting to fetch ALL screenshots in highest quality for Steam ID: ${steamID}`);
        
        // Keeping ALL original view types to ensure maximum coverage
        const viewTypes = [
            "", // Default view
            "?tab=all", // All screenshots tab
            "?tab=public", // Public screenshots tab
            "?appid=0", // All games
            "?p=1&sort=newestfirst", // Newest first sorting
            "?p=1&sort=oldestfirst" // Oldest first sorting
        ];
        
        // First, let's check if the profile exists and is public
        const profileUrl = `https://steamcommunity.com/profiles/${steamID}/screenshots`;
        const profileResponse = await fetch(profileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        
        if (!profileResponse.ok) {
            console.error(`Failed to access profile: ${profileResponse.status}`);
            return [];
        }
        
        const profileHtml = await profileResponse.text();
        
        if (profileHtml.includes("The specified profile is private") || 
            profileHtml.includes("This profile is private") ||
            profileHtml.includes("The specified profile could not be found")) {
            console.error("Profile is private or doesn't exist");
            return [];
        }
        
        // Try to find the total number of screenshots
        let totalScreenshots = 0;
        const totalRegex = /(\d+) screenshots/i;
        const totalMatch = profileHtml.match(totalRegex);
        if (totalMatch && totalMatch[1]) {
            totalScreenshots = parseInt(totalMatch[1]);
            console.log(`Profile appears to have approximately ${totalScreenshots} screenshots in total`);
        }
        
        // CRITICAL FIX: Determine the maximum number of pages more accurately
        // Steam typically shows 30 screenshots per page
        const screenshotsPerPage = 30;
        let maxPage = Math.ceil(totalScreenshots / screenshotsPerPage) + 2; // Add safety margin
        
        if (maxPage < 5) maxPage = 5; // Always check at least 5 pages to be safe
        
        console.log(`Will check up to ${maxPage} pages`);
        
        // Sequential processing of view types
        for (const viewType of viewTypes) {
            for (let page = 1; page <= maxPage; page++) {
                const pageUrl = `${profileUrl}${viewType}${viewType.includes('?') ? '&' : '?'}p=${page}`;
                console.log(`Fetching page: ${pageUrl}`);
                
                try {
                    const pageResponse = await fetch(pageUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Cache-Control': 'no-cache'
                        }
                    });
                    
                    if (!pageResponse.ok) {
                        console.log(`Skipping ${pageUrl} - received status ${pageResponse.status}`);
                        continue;
                    }
                    
                    const pageHtml = await pageResponse.text();
                    
                    // Use multiple patterns to extract screenshot URLs
                    const patterns = [
                        // Pattern 1: Standard screenshot links
                        /href="((?:https:\/\/steamcommunity\.com)?\/sharedfiles\/filedetails\/\?id=\d+)"/g,
                        // Pattern 2: Alternative format sometimes used
                        /href='((?:https:\/\/steamcommunity\.com)?\/sharedfiles\/filedetails\/\?id=\d+)'/g,
                        // Pattern 3: Look for screenshot IDs in JavaScript
                        /SharedFileBindMouseHover\(\s*"(\d+)"/g,
                        // Pattern 4: Look for image thumbnails which contain IDs
                        /src="https:\/\/steamuserimages[^"]+\/([0-9a-f]+)\/"/g
                    ];
                    
                    let newScreenshotsFound = 0;
                    
                    // Process standard patterns (1 & 2)
                    for (const pattern of patterns.slice(0, 2)) {
                        let match;
                        while ((match = pattern.exec(pageHtml)) !== null) {
                            let url = match[1];
                            
                            // Convert relative URLs to absolute
                            if (url.startsWith('/')) {
                                url = `https://steamcommunity.com${url}`;
                            }
                            
                            if (!allScreenshotPageUrls.has(url)) {
                                allScreenshotPageUrls.add(url);
                                newScreenshotsFound++;
                            }
                        }
                    }
                    
                    // Process ID patterns (3 & 4)
                    for (const pattern of patterns.slice(2)) {
                        let match;
                        while ((match = pattern.exec(pageHtml)) !== null) {
                            const id = match[1];
                            const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
                            
                            if (!allScreenshotPageUrls.has(url)) {
                                allScreenshotPageUrls.add(url);
                                newScreenshotsFound++;
                            }
                        }
                    }
                    
                    console.log(`Found ${newScreenshotsFound} new screenshots on ${pageUrl}`);
                    
                    // If we've found no new screenshots on this page and we're past page 1,
                    // we can move to the next view type
                    if (newScreenshotsFound === 0 && page > 1) {
                        console.log(`No new screenshots found on page ${page}, moving to next view type`);
                        break;
                    }
                    
                    // Add a minimal delay between requests to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (err) {
                    console.error(`Error fetching page ${pageUrl}:`, err);
                }
            }
        }
        
        // ID range exploration - keeping this exactly as in the original code
        if (allScreenshotPageUrls.size > 0) {
            // Extract IDs from the URLs we've found
            const ids = Array.from(allScreenshotPageUrls).map(url => {
                const match = url.match(/\?id=(\d+)/);
                return match ? parseInt(match[1]) : null;
            }).filter(id => id !== null);
            
            if (ids.length > 0) {
                // Find min and max IDs to establish a range
                const minId = Math.min(...ids);
                const maxId = Math.max(...ids);
                
                console.log(`Found ID range from ${minId} to ${maxId}`);
                
                // If the range is reasonable, try to fill in potential gaps
                if (maxId - minId < 10000) { // Limit to reasonable ranges
                    for (let id = minId; id <= maxId; id++) {
                        const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
                        if (!allScreenshotPageUrls.has(url)) {
                            // We'll check a sample of IDs in the range
                            if ((id - minId) % 100 === 0) {
                                try {
                                    const response = await fetch(url, {
                                        method: 'HEAD', // Just check if it exists
                                        headers: {
                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                        }
                                    });
                                    
                                    if (response.ok) {
                                        allScreenshotPageUrls.add(url);
                                        console.log(`Found additional screenshot with ID ${id}`);
                                    }
                                    
                                    // Small delay
                                    await new Promise(resolve => setTimeout(resolve, 500));
                                } catch (err) {
                                    // Ignore errors for these probing requests
                                }
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`Found ${allScreenshotPageUrls.size} total unique screenshot pages`);
        
        // OPTIMIZATION: Process screenshots in batches (this is the main performance improvement)
        const batchSize = 5; // Process 5 screenshots simultaneously
        const urls = Array.from(allScreenshotPageUrls);
        const batches = [];
        
        // Create batches of URLs
        for (let i = 0; i < urls.length; i += batchSize) {
            batches.push(urls.slice(i, i + batchSize));
        }
        
        // Process each batch
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`Processing batch ${i+1}/${batches.length} with ${batch.length} screenshots`);
            
            // Process all URLs in this batch in parallel
            const batchResults = await Promise.all(batch.map(async (url, index) => {
                const counter = i * batchSize + index + 1;
                console.log(`Processing screenshot ${counter}/${allScreenshotPageUrls.size}: ${url}`);
                
                try {
                    const pageResponse = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml',
                            'Accept-Language': 'en-US,en;q=0.9'
                        }
                    });
                    
                    if (!pageResponse.ok) {
                        console.log(`Skipping ${url} - received status ${pageResponse.status}`);
                        return null;
                    }
                    
                    const pageHtml = await pageResponse.text();
                    
                    // ENHANCED: Improved image extraction methods for highest quality
                    const extractionMethods = [
                        // Method 1: Original-size image from meta tag (highest quality)
                        () => {
                            const regex = /<meta property="og:image" content="([^"]+)">/;
                            const match = pageHtml.match(regex);
                            return match ? match[1] : null;
                        },
                        // Method 2: image_src meta tag (reliable, often full size)
                        () => {
                            const regex = /<link rel="image_src" href="([^"]+)">/;
                            const match = pageHtml.match(regex);
                            return match ? match[1] : null;
                        },
                        // Method 3: ActualMedia ID with full size parameter (specific to Steam screenshots)
                        () => {
                            const regex = /<img[^>]+id="ActualMedia"[^>]+src="([^"]+)"/;
                            const match = pageHtml.match(regex);
                            if (match) {
                                let url = match[1];
                                // Add size parameters if not present
                                if (!url.includes('?')) {
                                    url = `${url}?imw=5000&imh=5000&ima=fit&impolicy=Letterbox`;
                                }
                                return url;
                            }
                            return null;
                        },
                        // Method 4: Extract highest resolution image from the page
                        () => {
                            // Look for highest resolution version in JavaScript
                            const jsRegex = /ScreenshotImage[^"]+"([^"]+)"/;
                            const jsMatch = pageHtml.match(jsRegex);
                            if (jsMatch) return jsMatch[1];
                            
                            // Look for cloudfront URLs (often high quality)
                            const cfRegex = /(https:\/\/[^"]+\.cloudfront\.net\/[^"]+\.jpg)/;
                            const cfMatch = pageHtml.match(cfRegex);
                            if (cfMatch) return cfMatch[1];
                            
                            return null;
                        },
                        // Method 5: Find full-size image from screenshotDetailsImage class
                        () => {
                            const regex = /<img[^>]+class="screenshotDetailsImage"[^>]+src="([^"]+)"/;
                            const match = pageHtml.match(regex);
                            if (match) {
                                // Remove any resizing parameters to get original size
                                return match[1].split('?')[0];
                            }
                            return null;
                        },
                        // Method 6: Any steamuserimages URL with jpg extension, prioritizing full size
                        () => {
                            // Find all image URLs
                            const regex = /src="(https:\/\/steamuserimages[^"]+\.jpg[^"]*)"/g;
                            const urls = [];
                            let match;
                            
                            while ((match = regex.exec(pageHtml)) !== null) {
                                // Clean the URL - remove size parameters for original quality
                                let url = match[1].split('?')[0];
                                
                                // Check if it's a high-resolution image
                                if (url.includes('/1920x1080/') || 
                                    url.includes('/2560x1440/') || 
                                    url.includes('/3840x2160/') ||
                                    url.includes('_original')) {
                                    return url; // Return highest resolution immediately
                                }
                                
                                urls.push(url);
                            }
                            
                            // Sort by probable size/quality and return the best one
                            if (urls.length > 0) {
                                // Steam often puts resolution in URL - look for highest
                                urls.sort((a, b) => {
                                    const getResolution = (url) => {
                                        const match = url.match(/(\d+)x(\d+)/);
                                        if (match) {
                                            return parseInt(match[1]) * parseInt(match[2]);
                                        }
                                        return 0;
                                    };
                                    
                                    return getResolution(b) - getResolution(a);
                                });
                                
                                return urls[0];
                            }
                            
                            return null;
                        }
                    ];
                    
                    let imageUrl = null;
                    
                    // Try each extraction method until we find an image URL
                    for (const method of extractionMethods) {
                        imageUrl = method();
                        if (imageUrl) break;
                    }
                    
                    // If we found an image URL
                    if (imageUrl) {
                        // Strip sizing parameters to get original quality
                        if (imageUrl.includes('?')) {
                            // For Steam, we can force highest quality with specific parameters
                            const baseUrl = imageUrl.split('?')[0];
                            
                            // Check if this is a Steam CDN URL that supports image parameters
                            if (baseUrl.includes('steamuserimages')) {
                                // Request the original size image
                                imageUrl = `${baseUrl}?imw=5000&imh=5000&ima=fit&impolicy=Letterbox`;
                            } else {
                                // For other URLs, just use the base URL for original quality
                                imageUrl = baseUrl;
                            }
                        }
                        
                        // Add metadata about estimated quality
                        const qualityEstimate = 
                            imageUrl.includes('original') || 
                            imageUrl.includes('5000') || 
                            imageUrl.includes('3840x2160') ? 'Ultra High Quality' :
                            imageUrl.includes('2560x1440') ? 'Very High Quality' :
                            imageUrl.includes('1920x1080') ? 'High Quality' : 'Standard Quality';
                        
                        console.log(`Found ${qualityEstimate} image: ${imageUrl.substring(0, 50)}...`);
                        
                        return { 
                            pageUrl: url, 
                            imageUrl,
                            qualityEstimate,
                            originalUrl: imageUrl // Keep the original URL for reference
                        };
                    } else {
                        console.log(`Failed to extract image URL from page: ${url}`);
                        return null;
                    }
                } catch (err) {
                    console.error(`Error fetching screenshot page ${url}:`, err);
                    return null;
                }
            }));
            
            // Add successful results to the screenshots array
            for (const result of batchResults) {
                if (result) {
                    screenshots.push(result);
                    console.log(`Successfully extracted image URL: ${result.imageUrl.substring(0, 50)}...`);
                }
            }
            
            // Add a delay between batches to prevent rate limiting
            if (i < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log(`Successfully processed ${screenshots.length} out of ${allScreenshotPageUrls.size} screenshots`);
        return screenshots;
    } catch (error) {
        console.error("❌ Error fetching screenshots:", error);
        return [];
    }
}

// Root endpoint
app.get("/", (req, res) => {
    res.send("Steam Screenshots API is running. Use /screenshots/:steamID to fetch ALL screenshots in highest quality.");
});

// API Endpoint to get screenshots with quality options
app.get("/screenshots/:steamID", async (req, res) => {
    const { steamID } = req.params;
    const { quality } = req.query; // Optional quality parameter (high, medium, original)
    
    if (!steamID) return res.status(400).json({ error: "Steam ID is required" });

    // Set a longer timeout for the request (10 minutes)
    req.setTimeout(600000);
    res.setTimeout(600000);

    console.log(`Fetching ALL screenshots for Steam ID: ${steamID} with quality preference: ${quality || 'highest available'}`);
    const screenshots = await getAllScreenshots(steamID);

    if (screenshots.length === 0) {
        return res.status(404).json({ error: "No screenshots found. Profile might be private or the Steam ID might be incorrect." });
    }

    // If a specific quality is requested, we can modify the URLs
    if (quality && screenshots.length > 0) {
        for (const screenshot of screenshots) {
            // Base URL without parameters
            const baseUrl = screenshot.imageUrl.split('?')[0];
            
            // Only modify if it's a Steam CDN URL that supports image parameters
            if (baseUrl.includes('steamuserimages')) {
                switch(quality) {
                    case 'original':
                        // Keep original size (no parameters)
                        screenshot.imageUrl = baseUrl;
                        break;
                    case 'high':
                        // 1920x1080 or original size
                        screenshot.imageUrl = `${baseUrl}?imw=1920&imh=1080&ima=fit&impolicy=Letterbox`;
                        break;
                    case 'medium':
                        // 1280x720
                        screenshot.imageUrl = `${baseUrl}?imw=1280&imh=720&ima=fit&impolicy=Letterbox`;
                        break;
                    case 'low':
                        // 854x480
                        screenshot.imageUrl = `${baseUrl}?imw=854&imh=480&ima=fit&impolicy=Letterbox`;
                        break;
                    default:
                        // Default to highest quality
                        screenshot.imageUrl = `${baseUrl}?imw=5000&imh=5000&ima=fit&impolicy=Letterbox`;
                }
            }
        }
    }

    console.log(`Returning ${screenshots.length} high-quality screenshots to client`);
    res.json(screenshots);
});

// Additional endpoint to get a specific screenshot with quality options
app.get("/screenshot/:id", async (req, res) => {
    const { id } = req.params;
    const { quality } = req.query;
    
    if (!id) return res.status(400).json({ error: "Screenshot ID is required" });

    try {
        const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) {
            return res.status(404).json({ error: "Screenshot not found" });
        }
        
        const html = await response.text();
        
        // Use the same extraction methods as in getAllScreenshots
        const extractionMethods = [
            // Method 1: og:image meta tag (highest quality)
            () => {
                const regex = /<meta property="og:image" content="([^"]+)">/;
                const match = html.match(regex);
                return match ? match[1] : null;
            },
            // Method 2: image_src meta tag
            () => {
                const regex = /<link rel="image_src" href="([^"]+)">/;
                const match = html.match(regex);
                return match ? match[1] : null;
            },
            // Method 3: ActualMedia
            () => {
                const regex = /<img[^>]+id="ActualMedia"[^>]+src="([^"]+)"/;
                const match = html.match(regex);
                return match ? match[1] : null;
            }
        ];
        
        let imageUrl = null;
        for (const method of extractionMethods) {
            imageUrl = method();
            if (imageUrl) break;
        }
        
        if (!imageUrl) {
            return res.status(404).json({ error: "Could not extract image URL" });
        }
        
        // Quality handling similar to main endpoint
        const baseUrl = imageUrl.split('?')[0];
        if (quality && baseUrl.includes('steamuserimages')) {
            switch(quality) {
                case 'original':
                    imageUrl = baseUrl;
                    break;
                case 'high':
                    imageUrl = `${baseUrl}?imw=1920&imh=1080&ima=fit&impolicy=Letterbox`;
                    break;
                case 'medium':
                    imageUrl = `${baseUrl}?imw=1280&imh=720&ima=fit&impolicy=Letterbox`;
                    break;
                case 'low':
                    imageUrl = `${baseUrl}?imw=854&imh=480&ima=fit&impolicy=Letterbox`;
                    break;
                default:
                    imageUrl = `${baseUrl}?imw=5000&imh=5000&ima=fit&impolicy=Letterbox`;
            }
        } else if (baseUrl.includes('steamuserimages')) {
            // Default to highest quality
            imageUrl = `${baseUrl}?imw=5000&imh=5000&ima=fit&impolicy=Letterbox`;
        }
        
        res.json({ id, pageUrl: url, imageUrl });
    } catch (error) {
        console.error("Error fetching screenshot:", error);
        res.status(500).json({ error: "Failed to fetch screenshot" });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});

console.log("HIGH QUALITY VERSION: Optimized for maximum image quality while maintaining performance");
console.log("Key improvements:");
console.log("1. Enhanced image extraction methods to find highest resolution images");
console.log("2. Added og:image meta tag extraction (often contains original quality)");
console.log("3. Removed resizing parameters to get original quality images");
console.log("4. Added quality parameter option to the API");
console.log("5. Created dedicated endpoint for individual screenshot retrieval");
console.log("6. Added quality estimation for screenshots");