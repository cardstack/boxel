const express = require("express");
const cheerio = require("cheerio");
const cors = require("cors");
const NodeCache = require("node-cache");

const app = express();
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour (3600 seconds)

app.use(cors());

app.get("/search", async (req, res) => {
  const { text } = req.query;
  const cacheKey = `search:${text}`;

  // Check if the search results are already cached
  const cachedResults = cache.get(cacheKey);
  if (cachedResults) {
    console.log("Serving from cache");
    return res.json(cachedResults);
  }

  const url = `https://www.wickes.co.uk/search?text=${encodeURIComponent(
    text
  )}`;

  try {
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    const products = [];

    $(".card.product-card").each((index, element) => {
      const descriptionElement = $(element).find(".product-card__title");
      const description = descriptionElement.text().trim();

      const priceElement = $(element).find(".product-card__price-value");
      const price = priceElement.text().trim();
      if (index < 20) {
        products.push({ description, price });
      }
    });

    // Cache the search results
    cache.set(cacheKey, products);

    res.json(products);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
});

app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
