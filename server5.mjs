import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Function specifically designed to break past the 36 screenshot limit
async function getAllScreenshots(steamID) {
    const screenshots = [];
    const allScreenshotPageUrls = new Set(); // Using Set to avoid duplicates
    
    try {
        console.log(`Attempting to fetch ALL screenshots for Steam ID: ${steamID}`);
        
        // CRITICAL FIX: Steam organizes screenshots in different views
        // We need to try multiple view types to get all screenshots
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
        
        // CRITICAL FIX: Use multiple approaches to find all screenshot pages
        
        // Approach 1: Iterate through all view types and pages
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
                    
                    // CRITICAL FIX: Use multiple patterns to extract screenshot URLs
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
                    
                    // CRITICAL FIX: If we've found no new screenshots on this page and we're past page 1,
                    // we can move to the next view type
                    if (newScreenshotsFound === 0 && page > 1) {
                        console.log(`No new screenshots found on page ${page}, moving to next view type`);
                        break;
                    }
                    
                    // Add a delay between requests to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    
                } catch (err) {
                    console.error(`Error fetching page ${pageUrl}:`, err);
                }
            }
        }
        
        // CRITICAL FIX: Approach 2 - Try to directly access screenshot pages by ID range
        // This can help find screenshots that might not be listed in the gallery pages
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
        
        // CRITICAL FIX: Process each screenshot detail page with improved extraction
        let counter = 0;
        for (const pageUrl of allScreenshotPageUrls) {
            counter++;
            console.log(`Processing screenshot ${counter}/${allScreenshotPageUrls.size}: ${pageUrl}`);
            
            try {
                const pageResponse = await fetch(pageUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml',
                        'Accept-Language': 'en-US,en;q=0.9'
                    }
                });
                
                if (!pageResponse.ok) {
                    console.log(`Skipping ${pageUrl} - received status ${pageResponse.status}`);
                    continue;
                }
                
                const pageHtml = await pageResponse.text();
                
                // CRITICAL FIX: More comprehensive extraction methods
                const extractionMethods = [
                    // Method 1: image_src meta tag (most reliable)
                    () => {
                        const regex = /<link rel="image_src" href="([^"]+)">/;
                        const match = pageHtml.match(regex);
                        return match ? match[1] : null;
                    },
                    // Method 2: ActualMedia ID (specific to Steam screenshots)
                    () => {
                        const regex = /<img[^>]+id="ActualMedia"[^>]+src="([^"]+)"/;
                        const match = pageHtml.match(regex);
                        return match ? match[1] : null;
                    },
                    // Method 3: screenshotDetailsImage class
                    () => {
                        const regex = /<img[^>]+class="screenshotDetailsImage"[^>]+src="([^"]+)"/;
                        const match = pageHtml.match(regex);
                        return match ? match[1] : null;
                    },
                    // Method 4: Any steamuserimages URL with jpg extension
                    () => {
                        const regex = /src="(https:\/\/steamuserimages[^"]+\.jpg)"/;
                        const match = pageHtml.match(regex);
                        return match ? match[1] : null;
                    },
                    // Method 5: Look for the full-size image URL in JavaScript
                    () => {
                        const regex = /ScreenshotImage[^"]+"([^"]+)"/;
                        const match = pageHtml.match(regex);
                        return match ? match[1] : null;
                    },
                    // Method 6: Look for any image with a high resolution
                    () => {
                        const regex = /src="(https:\/\/steamuserimages[^"]+)"[^>]+>/g;
                        let bestMatch = null;
                        let bestSize = 0;
                        
                        let match;
                        while ((match = regex.exec(pageHtml)) !== null) {
                            const url = match[1];
                            // Look for resolution indicators in the URL
                            const sizeMatch = url.match(/(\d+)x(\d+)/);
                            if (sizeMatch) {
                                const size = parseInt(sizeMatch[1]) * parseInt(sizeMatch[2]);
                                if (size > bestSize) {
                                    bestSize = size;
                                    bestMatch = url;
                                }
                            }
                        }
                        return bestMatch;
                    }
                ];
                
                let imageUrl = null;
                
                // Try each extraction method until we find an image URL
                for (const method of extractionMethods) {
                    imageUrl = method();
                    if (imageUrl) break;
                }
                
                if (imageUrl) {
                    // Get the highest resolution version
                    imageUrl = imageUrl.split('?')[0];
                    
                    screenshots.push({
                        pageUrl: pageUrl,
                        imageUrl: imageUrl
                    });
                    console.log(`Successfully extracted image URL: ${imageUrl.substring(0, 50)}...`);
                } else {
                    console.log(`Failed to extract image URL from page: ${pageUrl}`);
                }
                
                // Variable delay based on progress
                const delay = counter % 5 === 0 ? 2000 : 1000; // Longer pause every 5 requests
                await new Promise(resolve => setTimeout(resolve, delay));
            } catch (err) {
                console.error(`Error fetching screenshot page ${pageUrl}:`, err);
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
    res.send("Steam Screenshots API is running. Use /screenshots/:steamID to fetch ALL screenshots.");
});

// API Endpoint to get screenshots
app.get("/screenshots/:steamID", async (req, res) => {
    const { steamID } = req.params;
    if (!steamID) return res.status(400).json({ error: "Steam ID is required" });

    // Set a longer timeout for the request (10 minutes)
    req.setTimeout(600000);
    res.setTimeout(600000);

    console.log(`Fetching ALL screenshots for Steam ID: ${steamID}`);
    const screenshots = await getAllScreenshots(steamID);

    if (screenshots.length === 0) {
        return res.status(404).json({ error: "No screenshots found. Profile might be private or the Steam ID might be incorrect." });
    }

    console.log(`Returning ${screenshots.length} screenshots to client`);
    res.json(screenshots);
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});

// For testing in this environment
console.log("CRITICAL FIX: This version specifically addresses the 36 screenshot limit");
console.log("Key improvements:");
console.log("1. Uses multiple view types to find all screenshots");
console.log("2. Tries different sorting methods to find more screenshots");
console.log("3. Uses ID range exploration to find screenshots not in the gallery");
console.log("4. More aggressive extraction methods");
console.log("5. Increased timeouts to 10 minutes");