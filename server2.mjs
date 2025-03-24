import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Function to fetch all screenshots without limits
async function getAllScreenshots(steamID) {
    const screenshots = [];
    let allScreenshotPageUrls = [];
    
    try {
        // First, try to get all screenshots from the main profile page
        const mainProfileUrl = `https://steamcommunity.com/profiles/${steamID}/screenshots`;
        console.log(`Fetching screenshots from main profile: ${mainProfileUrl}`);
        
        const mainResponse = await fetch(mainProfileUrl);
        const mainHtml = await mainResponse.text();
        
        // Check if profile is private
        if (mainHtml.includes("The specified profile is private") || 
            mainHtml.includes("This profile is private")) {
            console.error("Profile is private");
            return [];
        }
        
        // Get screenshot links from the main page
        let regex = /href="(https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=\d+)"/g;
        let match;
        const mainPageUrls = [];
        
        while ((match = regex.exec(mainHtml)) !== null) {
            if (!mainPageUrls.includes(match[1])) {
                mainPageUrls.push(match[1]);
            }
        }
        
        console.log(`Found ${mainPageUrls.length} screenshots on main page`);
        allScreenshotPageUrls = [...mainPageUrls];
        
        // Check if there are additional pages by looking for page navigation
        if (mainHtml.includes('id="pagebtn_next"') || mainHtml.includes('class="pagebtn"')) {
            // Determine how many pages to fetch
            let maxPage = 1;
            const pageRegex = /\?p=(\d+)/g;
            while ((match = pageRegex.exec(mainHtml)) !== null) {
                const pageNum = parseInt(match[1]);
                if (pageNum > maxPage) maxPage = pageNum;
            }
            
            console.log(`Found ${maxPage} total pages of screenshots`);
            
            // Fetch each additional page
            for (let page = 2; page <= maxPage + 1; page++) {
                const pageUrl = `${mainProfileUrl}/?p=${page}`;
                console.log(`Fetching screenshots page ${page}: ${pageUrl}`);
                
                try {
                    const pageResponse = await fetch(pageUrl);
                    const pageHtml = await pageResponse.text();
                    
                    let pageMatch;
                    const pageScreenshotUrls = [];
                    
                    while ((pageMatch = regex.exec(pageHtml)) !== null) {
                        if (!pageScreenshotUrls.includes(pageMatch[1]) && 
                            !allScreenshotPageUrls.includes(pageMatch[1])) {
                            pageScreenshotUrls.push(pageMatch[1]);
                        }
                    }
                    
                    console.log(`Found ${pageScreenshotUrls.length} screenshots on page ${page}`);
                    allScreenshotPageUrls = [...allScreenshotPageUrls, ...pageScreenshotUrls];
                    
                    // If no screenshots found on this page, break the loop
                    if (pageScreenshotUrls.length === 0) {
                        console.log(`No screenshots found on page ${page}, stopping pagination`);
                        break;
                    }
                } catch (err) {
                    console.error(`Error fetching page ${page}:`, err);
                }
            }
        }
        
        // Remove any duplicate URLs
        allScreenshotPageUrls = [...new Set(allScreenshotPageUrls)];
        console.log(`Found ${allScreenshotPageUrls.length} total unique screenshots`);
        
        // Visit each screenshot page to extract the actual image URL
        for (let i = 0; i < allScreenshotPageUrls.length; i++) {
            const pageUrl = allScreenshotPageUrls[i];
            console.log(`Processing screenshot ${i+1}/${allScreenshotPageUrls.length}: ${pageUrl}`);
            
            try {
                const pageResponse = await fetch(pageUrl);
                const pageHtml = await pageResponse.text();
                
                // Extract the actual full-size image URL
                const imageRegex = /<link rel="image_src" href="([^"]+)">/;
                const imageMatch = pageHtml.match(imageRegex);
                
                if (imageMatch && imageMatch[1]) {
                    screenshots.push({
                        pageUrl: pageUrl,
                        imageUrl: imageMatch[1]
                    });
                    console.log(`Successfully extracted image URL: ${imageMatch[1].substring(0, 50)}...`);
                } else {
                    // Fallback method to try finding image
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
            } catch (err) {
                console.error(`Error fetching screenshot page ${pageUrl}:`, err);
            }
        }
        
        console.log(`Successfully processed ${screenshots.length} out of ${allScreenshotPageUrls.length} screenshots`);
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

// API Endpoint to get screenshots dynamically - no limits
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

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});