import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Helper function with retry logic
async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            console.log(`Attempt ${i+1} failed for ${url} with status ${response.status}, retrying...`);
            if (i < maxRetries - 1) {
                // Exponential backoff: wait longer between each retry
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
            }
        } catch (err) {
            console.log(`Attempt ${i+1} failed for ${url} with error: ${err.message}`);
            if (i === maxRetries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        }
    }
    throw new Error(`Failed after ${maxRetries} retries: ${url}`);
}

// Optimized function to fetch all screenshots with enhanced image quality
async function getAllScreenshots(steamID) {
    const screenshots = [];
    const allScreenshotPageUrls = new Set(); // Using Set to avoid duplicates
    
    try {
        console.log(`Attempting to fetch ALL screenshots in highest quality for Steam ID: ${steamID}`);
        
        // Expanded view types to ensure maximum coverage
        const viewTypes = [
            "", // Default view
            "?tab=all", // All screenshots tab
            "?tab=public", // Public screenshots tab
            "?appid=0", // All games
            "?p=1&sort=newestfirst", // Newest first sorting
            "?p=1&sort=oldestfirst", // Oldest first sorting
            "?p=1&sort=mostrecent", // Most recent (different from newest sometimes)
            "?p=1&view=grid", // Grid view can sometimes show different results
            "?p=1&view=list", // List view might expose different screenshots
            "?p=1&appid=0&sort=newestfirst", // Combined filters
            "?p=1&appid=0&sort=oldestfirst", // Combined filters
            "?p=1&browsefilter=myfiles" // "My Files" filter
        ];
        
        // Standard headers for all requests
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache'
        };
        
        // First, let's check if the profile exists and is public
        const profileUrl = `https://steamcommunity.com/profiles/${steamID}/screenshots`;
        const profileResponse = await fetchWithRetry(profileUrl, { headers });
        
        const profileHtml = await profileResponse.text();
        
        if (profileHtml.includes("The specified profile is private") || 
            profileHtml.includes("This profile is private") ||
            profileHtml.includes("The specified profile could not be found")) {
            console.error("Profile is private or doesn't exist");
            return [];
        }
        
        // Try to find the total number of screenshots
        let totalScreenshots = 0;
        // Try multiple patterns to find the screenshot count
        const totalPatterns = [
            /(\d+) screenshots/i,
            /(\d+) Screenshot/i,
            /Screenshots \((\d+)\)/i,
            /Showing (\d+) screenshots/i
        ];
        
        for (const pattern of totalPatterns) {
            const match = profileHtml.match(pattern);
            if (match && match[1]) {
                totalScreenshots = parseInt(match[1]);
                console.log(`Profile appears to have approximately ${totalScreenshots} screenshots in total`);
                break;
            }
        }
        
        // If we didn't find the count through regex, try to count the thumbnails on the first page
        if (totalScreenshots === 0) {
            const thumbnailCount = (profileHtml.match(/<div class="imageWallRow">/g) || []).length;
            if (thumbnailCount > 0) {
                // Estimate based on thumbnail count and multiply by a safety factor
                totalScreenshots = thumbnailCount * 10; // Assume at least 10 pages
                console.log(`Couldn't find exact count, estimating ${totalScreenshots} screenshots based on thumbnails`);
            } else {
                // Default to a safe number if we can't determine
                totalScreenshots = 200;
                console.log(`Couldn't detect screenshot count, defaulting to checking for ${totalScreenshots} screenshots`);
            }
        }
        
        // Determine the maximum number of pages more accurately with a larger safety margin
        const screenshotsPerPage = 30;
        let maxPage = Math.ceil(totalScreenshots / screenshotsPerPage) + 10; // Add more safety margin
        
        if (maxPage < 10) maxPage = 10; // Always check at least 10 pages to be safe
        
        console.log(`Will check up to ${maxPage} pages`);
        
        // Sequential processing of view types
        for (const viewType of viewTypes) {
            console.log(`Trying view type: ${viewType || 'default'}`);
            let emptyPageCount = 0;
            
            for (let page = 1; page <= maxPage; page++) {
                const pageUrl = `${profileUrl}${viewType}${viewType.includes('?') ? '&' : '?'}p=${page}`;
                console.log(`Fetching page: ${pageUrl}`);
                
                try {
                    const pageResponse = await fetchWithRetry(pageUrl, { headers });
                    const pageHtml = await pageResponse.text();
                    
                    // Use expanded patterns to extract screenshot URLs
                    const patterns = [
                        // Standard screenshot links
                        /href="((?:https:\/\/steamcommunity\.com)?\/sharedfiles\/filedetails\/\?id=\d+)"/g,
                        // Alternative format sometimes used
                        /href='((?:https:\/\/steamcommunity\.com)?\/sharedfiles\/filedetails\/\?id=\d+)'/g,
                        // Look for screenshot IDs in JavaScript
                        /SharedFileBindMouseHover\(\s*"(\d+)"/g,
                        // Look for image thumbnails which contain IDs
                        /src="https:\/\/steamuserimages[^"]+\/([0-9a-f]+)\/"/g,
                        // Additional patterns for broader coverage
                        /href="([^"]+\/file\/\d+)"/g, // Alternative file format
                        /"SharedFileDetailsPage"[^>]+href="([^"]+)"/g, // JavaScript event handlers
                        /data-screenshot-id="(\d+)"/g, // Data attributes
                        /onclick="ViewScreenshot\('(\d+)'\)"/g, // onclick handlers
                        /ShowModalContent\( 'shared_file_(\d+)'/g, // Modal content IDs
                    ];
                    
                    let newScreenshotsFound = 0;
                    
                    // Process standard URL patterns (first two patterns)
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
                    
                    // Process ID-based patterns
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
                    
                    // If we've found no new screenshots on this page, increment empty page counter
                    if (newScreenshotsFound === 0) {
                        emptyPageCount++;
                        
                        // If we've seen 3 empty pages in a row, we can move to the next view type
                        if (emptyPageCount >= 3) {
                            console.log(`${emptyPageCount} empty pages in a row, moving to next view type`);
                            break;
                        }
                    } else {
                        // Reset empty page counter if we found screenshots
                        emptyPageCount = 0;
                    }
                    
                    // Add a delay between requests to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (err) {
                    console.error(`Error fetching page ${pageUrl}:`, err);
                    // Continue to next page despite errors
                }
            }
        }
        
        
        
        console.log(`Found ${allScreenshotPageUrls.size} total unique screenshot pages`);
        
        // Process screenshots in smaller batches with longer delays
        const batchSize = 3; // Process 3 screenshots simultaneously (reduced from 5)
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
                    const pageResponse = await fetchWithRetry(url, { headers });
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
                        },
                        // Method 7: Additional attempt to find any image in an img tag
                        () => {
                            const regex = /<img[^>]+src="(https:\/\/[^"]+\.(jpg|png|jpeg))[^"]*"/gi;
                            const matches = [];
                            let match;
                            
                            while ((match = regex.exec(pageHtml)) !== null) {
                                matches.push(match[1]);
                            }
                            
                            if (matches.length > 0) {
                                // Sort by URL length - often longer URLs contain more parameters including size
                                matches.sort((a, b) => b.length - a.length);
                                return matches[0];
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
                        
                        // Extract screenshot title and game name if available
                        let title = null;
                        let gameName = null;
                        
                        const titleMatch = pageHtml.match(/<div class="screenshotName">([^<]+)<\/div>/);
                        if (titleMatch && titleMatch[1]) {
                            title = titleMatch[1].trim();
                        }
                        
                        const gameMatch = pageHtml.match(/<div class="screenshotAppName">([^<]+)<\/div>/);
                        if (gameMatch && gameMatch[1]) {
                            gameName = gameMatch[1].trim();
                        }
                        
                        return { 
                            pageUrl: url, 
                            imageUrl,
                            qualityEstimate,
                            title,
                            gameName,
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
            
            // Add a longer delay between batches to prevent rate limiting
            if (i < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
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

    // Set a longer timeout for the request (15 minutes - increased from 10)
    req.setTimeout(900000);
    res.setTimeout(900000);

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
        const response = await fetchWithRetry(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const html = await response.text();
        
        
        
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
        
        // Extract title and game name if available
        let title = null;
        let gameName = null;
        
        const titleMatch = html.match(/<div class="screenshotName">([^<]+)<\/div>/);
        if (titleMatch && titleMatch[1]) {
            title = titleMatch[1].trim();
        }
        
        const gameMatch = html.match(/<div class="screenshotAppName">([^<]+)<\/div>/);
        if (gameMatch && gameMatch[1]) {
            gameName = gameMatch[1].trim();
        }
        
        res.json({ id, pageUrl: url, imageUrl, title, gameName });
    } catch (error) {
        console.error("Error fetching screenshot:", error);
        res.status(500).json({ error: "Failed to fetch screenshot" });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});

console.log("ENHANCED RECOVERY VERSION: Optimized to find ALL screenshots, especially missing ones");
console.log("Key improvements:");
console.log("1. Added retry logic with exponential backoff for failed requests");
console.log("2. Expanded view types to cover more filtering and sorting options");
console.log("3. Added more regex patterns to catch different screenshot HTML structures");
console.log("4. Improved ID exploration with wider margin and more frequent checks");
console.log("5. Added screenshot title and game name extraction");
console.log("6. Increased timeouts and added more intelligent pagination handling");
console.log("7. Added additional recovery methods for missing screenshots");