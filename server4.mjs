import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Function to fetch all screenshots with advanced techniques
async function getAllScreenshots(steamID) {
    const screenshots = [];
    const allScreenshotPageUrls = new Set(); // Using Set to avoid duplicates
    
    try {
        // Try multiple profile URL formats to ensure we get everything
        const profileURLs = [
            `https://steamcommunity.com/profiles/${steamID}/screenshots`,
            `https://steamcommunity.com/profiles/${steamID}/screenshots/?p=1`,
            `https://steamcommunity.com/profiles/${steamID}/screenshots/?tab=all`
        ];
        
        // Check if profile exists and is public
        console.log(`Checking profile accessibility...`);
        const initialResponse = await fetch(profileURLs[0]);
        const initialHtml = await initialResponse.text();
        
        // Check if profile is private or doesn't exist
        if (initialHtml.includes("The specified profile is private") || 
            initialHtml.includes("This profile is private") ||
            initialHtml.includes("The specified profile could not be found")) {
            console.error("Profile is private or doesn't exist");
            return [];
        }
        
        // First approach: Try to find the total number of screenshots from the page
        let totalScreenshots = 0;
        const totalRegex = /(\d+) screenshots/i;
        const totalMatch = initialHtml.match(totalRegex);
        if (totalMatch && totalMatch[1]) {
            totalScreenshots = parseInt(totalMatch[1]);
            console.log(`Profile appears to have approximately ${totalScreenshots} screenshots in total`);
        }
        
        // Determine maximum page number from pagination links
        let maxPage = 1;
        const pageRegex = /\?p=(\d+)/g;
        let pageMatch;
        
        while ((pageMatch = pageRegex.exec(initialHtml)) !== null) {
            const pageNum = parseInt(pageMatch[1]);
            if (pageNum > maxPage) maxPage = pageNum;
        }
        
        console.log(`Found pagination with ${maxPage} pages`);
        
        // If we didn't find pagination but know there are screenshots, assume at least 3 pages to check
        if (maxPage === 1 && totalScreenshots > 30) {
            maxPage = Math.ceil(totalScreenshots / 12); // Steam typically shows 12 screenshots per page
            console.log(`Estimated ${maxPage} pages based on total screenshot count`);
        }
        
        // Add extra pages to be safe
        maxPage += 2;
        
        // Process all pages including the first one
        for (let page = 1; page <= maxPage; page++) {
            // Try multiple URL formats for each page
            const pageUrls = [
                page === 1 ? profileURLs[0] : `${profileURLs[0]}/?p=${page}`,
                `${profileURLs[0]}/?p=${page}&sort=newestfirst`,
                `${profileURLs[0]}/?p=${page}&sort=oldestfirst`
            ];
            
            for (const pageUrl of pageUrls) {
                console.log(`Fetching screenshots page ${page}/${maxPage}: ${pageUrl}`);
                
                try {
                    const pageResponse = await fetch(pageUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    });
                    
                    if (!pageResponse.ok) {
                        console.log(`Skipping ${pageUrl} - received status ${pageResponse.status}`);
                        continue;
                    }
                    
                    const pageHtml = await pageResponse.text();
                    
                    // Extract screenshot detail page URLs - try multiple patterns
                    const patterns = [
                        /href="(https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=\d+)"/g,
                        /href='(https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=\d+)'/g,
                        /href="(\/sharedfiles\/filedetails\/\?id=\d+)"/g
                    ];
                    
                    let pageScreenshotCount = 0;
                    
                    for (const pattern of patterns) {
                        let screenshotMatch;
                        while ((screenshotMatch = pattern.exec(pageHtml)) !== null) {
                            let url = screenshotMatch[1];
                            
                            // Convert relative URLs to absolute
                            if (url.startsWith('/')) {
                                url = `https://steamcommunity.com${url}`;
                            }
                            
                            if (!allScreenshotPageUrls.has(url)) {
                                allScreenshotPageUrls.add(url);
                                pageScreenshotCount++;
                            }
                        }
                    }
                    
                    console.log(`Found ${pageScreenshotCount} new screenshots on ${pageUrl}`);
                    
                    // If we found screenshots on this page, no need to try other URL formats
                    if (pageScreenshotCount > 0) {
                        break;
                    }
                } catch (err) {
                    console.error(`Error fetching page ${pageUrl}:`, err);
                }
                
                // Add a small delay between requests
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        console.log(`Found ${allScreenshotPageUrls.size} total unique screenshot pages`);
        
        // Process each screenshot detail page to extract the actual image URL
        let counter = 0;
        for (const pageUrl of allScreenshotPageUrls) {
            counter++;
            console.log(`Processing screenshot ${counter}/${allScreenshotPageUrls.size}: ${pageUrl}`);
            
            try {
                const pageResponse = await fetch(pageUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                
                if (!pageResponse.ok) {
                    console.log(`Skipping ${pageUrl} - received status ${pageResponse.status}`);
                    continue;
                }
                
                const pageHtml = await pageResponse.text();
                
                // Try multiple methods to extract the image URL
                const extractionMethods = [
                    // Method 1: image_src meta tag
                    () => {
                        const regex = /<link rel="image_src" href="([^"]+)">/;
                        const match = pageHtml.match(regex);
                        return match ? match[1] : null;
                    },
                    // Method 2: steamuserimages in src attribute
                    () => {
                        const regex = /src="(https:\/\/steamuserimages[^"]+\.jpg)"/;
                        const match = pageHtml.match(regex);
                        return match ? match[1] : null;
                    },
                    // Method 3: Look for the actual screenshot image
                    () => {
                        const regex = /<img[^>]+id="ActualMedia"[^>]+src="([^"]+)"/;
                        const match = pageHtml.match(regex);
                        return match ? match[1] : null;
                    },
                    // Method 4: Look for any large image that might be the screenshot
                    () => {
                        const regex = /<img[^>]+src="(https:\/\/steamuserimages[^"]+)"[^>]+class="screenshotDetailsImage"/;
                        const match = pageHtml.match(regex);
                        return match ? match[1] : null;
                    }
                ];
                
                let imageUrl = null;
                
                // Try each extraction method until we find an image URL
                for (const method of extractionMethods) {
                    imageUrl = method();
                    if (imageUrl) break;
                }
                
                if (imageUrl) {
                    screenshots.push({
                        pageUrl: pageUrl,
                        imageUrl: imageUrl
                    });
                    console.log(`Successfully extracted image URL: ${imageUrl.substring(0, 50)}...`);
                } else {
                    console.log(`Failed to extract image URL from page: ${pageUrl}`);
                }
                
                // Add a small delay between requests
                await new Promise(resolve => setTimeout(resolve, 300));
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

console.log(`To use this in your project, run it with Node.js and make API calls to http://localhost:3000/screenshots/{steamID}`);
