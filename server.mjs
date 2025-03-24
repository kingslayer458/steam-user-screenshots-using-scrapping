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
    const profileURL = `https://steamcommunity.com/profiles/${steamID}/screenshots`;
    
    try {
        // First get all screenshot page links
        const response = await fetch(profileURL);
        const html = await response.text();
        const regex = /href="(https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=\d+)"/g;
        let match;
        const screenshotPageUrls = [];
        
        while ((match = regex.exec(html)) !== null) {
            screenshotPageUrls.push(match[1]);
        }
        
        console.log(`Found ${screenshotPageUrls.length} total screenshots for Steam ID: ${steamID}`);
        
        // Visit each screenshot page to extract the actual image URL
        // No limit - process ALL screenshots
        for (let i = 0; i < screenshotPageUrls.length; i++) {
            const pageUrl = screenshotPageUrls[i];
            console.log(`Processing screenshot ${i+1}/${screenshotPageUrls.length}: ${pageUrl}`);
            
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
                    console.log(`Failed to extract image URL from page: ${pageUrl}`);
                }
            } catch (err) {
                console.error(`Error fetching screenshot page ${pageUrl}:`, err);
            }
        }
        
        console.log(`Successfully processed ${screenshots.length} out of ${screenshotPageUrls.length} screenshots`);
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
        return res.status(404).json({ error: "No screenshots found. Profile might be private." });
    }

    console.log(`Returning ${screenshots.length} screenshots to client`);
    res.json(screenshots);
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});