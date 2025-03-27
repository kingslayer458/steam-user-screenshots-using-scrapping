import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Function to fetch all screenshots with proper pagination
async function getAllScreenshots(steamID) {
    const screenshots = [];
    const allScreenshotPageUrls = new Set(); // Using Set to avoid duplicates
    const baseProfileURL = `https://steamcommunity.com/profiles/${steamID}/screenshots`;
    
    try {
        // First check if profile exists and is public
        console.log(`Checking profile: ${baseProfileURL}`);
        const initialResponse = await fetch(baseProfileURL);
        const initialHtml = await initialResponse.text();
        
        // Check if profile is private or doesn't exist
        if (initialHtml.includes("The specified profile is private") || 
            initialHtml.includes("This profile is private") ||
            initialHtml.includes("The specified profile could not be found")) {
            console.error("Profile is private or doesn't exist");
            return [];
        }
        
        // Determine total number of pages
        let maxPage = 1;
        const pageRegex = /\?p=(\d+)/g;
        let pageMatch;
        
        while ((pageMatch = pageRegex.exec(initialHtml)) !== null) {
            const pageNum = parseInt(pageMatch[1]);
            if (pageNum > maxPage) maxPage = pageNum;
        }
        
        console.log(`Found ${maxPage} total pages of screenshots`);
        
        // Process all pages including the first one
        for (let page = 1; page <= maxPage + 1; page++) {
            const pageUrl = page === 1 ? baseProfileURL : `${baseProfileURL}/?p=${page}`;
            console.log(`Fetching screenshots page ${page}/${maxPage + 1}: ${pageUrl}`);
            
            try {
                const pageResponse = await fetch(pageUrl);
                const pageHtml = await pageResponse.text();
                
                // Extract screenshot detail page URLs
                const screenshotRegex = /href="(https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=\d+)"/g;
                let screenshotMatch;
                let pageScreenshotCount = 0;
                
                while ((screenshotMatch = screenshotRegex.exec(pageHtml)) !== null) {
                    if (!allScreenshotPageUrls.has(screenshotMatch[1])) {
                        allScreenshotPageUrls.add(screenshotMatch[1]);
                        pageScreenshotCount++;
                    }
                }
                
                console.log(`Found ${pageScreenshotCount} new screenshots on page ${page}`);
                
                // If no new screenshots found on this page and it's not the first page, we might be done
                if (pageScreenshotCount === 0 && page > 1) {
                    console.log(`No new screenshots found on page ${page}, might be at the end`);
                    // Continue anyway to check next page, just in case
                }
            } catch (err) {
                console.error(`Error fetching page ${page}:`, err);
            }
            
            // Add a small delay between page requests to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log(`Found ${allScreenshotPageUrls.size} total unique screenshot pages`);
        
        // Process each screenshot detail page to extract the actual image URL
        let counter = 0;
        for (const pageUrl of allScreenshotPageUrls) {
            counter++;
            console.log(`Processing screenshot ${counter}/${allScreenshotPageUrls.size}: ${pageUrl}`);
            
            try {
                const pageResponse = await fetch(pageUrl);
                const pageHtml = await pageResponse.text();
                
                // Primary method: Extract the image URL from the image_src link
                const imageRegex = /<link rel="image_src" href="([^"]+)">/;
                const imageMatch = pageHtml.match(imageRegex);
                
                if (imageMatch && imageMatch[1]) {
                    screenshots.push({
                        pageUrl: pageUrl,
                        imageUrl: imageMatch[1]
                    });
                    console.log(`Successfully extracted image URL: ${imageMatch[1].substring(0, 50)}...`);
                } else {
                    // Fallback method: Look for steamuserimages in the HTML
                    const altImageRegex = /src="(https:\/\/steamuserimages[^"]+\.jpg)"/;
                    const altMatch = pageHtml.match(altImageRegex);
                    
                    if (altMatch && altMatch[1]) {
                        screenshots.push({
                            pageUrl: pageUrl,
                            imageUrl: altMatch[1]
                        });
                        console.log(`Successfully extracted image URL (fallback): ${altMatch[1].substring(0, 50)}...`);
                    } else {
                        console.log(`Failed to extract image URL from page: ${pageUrl}`);
                    }
                }
                
                // Add a small delay between requests to avoid rate limiting
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
// Replace with a valid Steam ID to test
const testSteamID = "76561198000000000"; // Example ID, replace with real one

console.log(`To use this in your project, run it with Node.js and make API calls to http://localhost:3000/screenshots/{steamID}`);
