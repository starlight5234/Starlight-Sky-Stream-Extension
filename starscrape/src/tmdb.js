const TMDB_API_KEY = "TMDB_API_KEY_PLACEHOLDER";

function parseJsonSafe(text, fallback = {}) {
    if (!text) return fallback;
    try {
        return JSON.parse(text);
    } catch (_) {
        return fallback;
    }
}

function toMessage(e) {
    if (!e) return "Unknown error";
    if (typeof e === "string") return e;
    const msg = String(e.message || e);
    const stack = e.stack ? String(e.stack).trim() : "";
    if (stack && stack !== "@") {
        return msg + "\n" + stack;
    }
    return msg;
}

async function httpGetWithRetry(url, headers = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await http_get(url, headers);
            if (res && res.code === 200) {
                return res;
            }
            console.warn(`GET ${url} attempt ${i + 1} failed: HTTP ${res ? res.code : "unknown"}`);
        } catch (e) {
            console.warn(`GET ${url} attempt ${i + 1} threw: ${e}`);
        }
        if (i < retries) {
            await new Promise(resolve => {
                if (typeof setTimeout !== "undefined") {
                    setTimeout(resolve, 300);
                } else {
                    resolve();
                }
            });
        }
    }
    return null;
}

/**
 * Parses standard TMDB results into MultimediaItems compatible with SkyStream.
 */
function parseTmdbItem(item, forceType) {
    const type = forceType || item.media_type || (item.name ? "tv" : "movie");
    const title = item.title || item.name || item.original_title || item.original_name || "";
    const id = item.id;
    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : "";
    const url = `https://watch32to.com/${type}/${id}`;

    return new MultimediaItem({
        title: title,
        url: url,
        posterUrl: posterUrl,
        type: type === "tv" ? "series" : "movie"
    });
}

/**
 * Loads popular categories from TMDB.
 */
async function fetchHomeCategories() {
    const apiKey = TMDB_API_KEY;
    const results = await http_parallel([
        { url: `https://api.themoviedb.org/3/trending/all/week?api_key=${apiKey}`, method: "GET", headers: {} },
        { url: `https://api.themoviedb.org/3/movie/popular?api_key=${apiKey}`, method: "GET", headers: {} },
        { url: `https://api.themoviedb.org/3/tv/popular?api_key=${apiKey}`, method: "GET", headers: {} }
    ]);

    const trendingData = parseJsonSafe(results[0] && results[0].body).results || [];
    const moviesData = parseJsonSafe(results[1] && results[1].body).results || [];
    const tvData = parseJsonSafe(results[2] && results[2].body).results || [];

    const trendingCards = trendingData.map(item => parseTmdbItem(item));
    const moviesCards = moviesData.map(item => parseTmdbItem(item, "movie"));
    const tvCards = tvData.map(item => parseTmdbItem(item, "tv"));

    const data = {};
    if (trendingCards.length > 0) data["Trending"] = trendingCards.slice(0, 20);
    if (moviesCards.length > 0) data["Movies"] = moviesCards.slice(0, 20);
    if (tvCards.length > 0) data["TV Shows"] = tvCards.slice(0, 20);
    return data;
}

/**
 * Searches for movie/show listings.
 */
async function searchMedia(query, page) {
    const apiKey = TMDB_API_KEY;
    const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}&page=${page}`;

    const res = await httpGetWithRetry(searchUrl);
    if (!res || res.code !== 200) {
        throw new Error("Search failed: HTTP " + (res ? res.code : "unknown") + (res && res.error ? " (" + res.error + ")" : ""));
    }
    const data = parseJsonSafe(res.body);
    const results = data.results || [];

    return results
        .filter(item => item.media_type === "movie" || item.media_type === "tv")
        .map(item => parseTmdbItem(item));
}

/**
 * Searches for movie/show listings.
 */
async function fetchMediaDetails(url) {
    const apiKey = TMDB_API_KEY;
    const isTv = url.includes('/tv/');
    const slugMatch = url.match(/\/(?:movie|tv)\/(\d+)/);
    const tmdbId = slugMatch ? slugMatch[1] : "";

    if (!tmdbId) {
        throw new Error("Could not parse TMDB ID from url: " + url);
    }

    const type = isTv ? "tv" : "movie";
    const detailsRes = await httpGetWithRetry(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}`);
    if (!detailsRes || detailsRes.code !== 200) {
        throw new Error("Failed to fetch TMDB media details: HTTP " + (detailsRes ? detailsRes.code : "unknown") + (detailsRes && detailsRes.error ? " (" + detailsRes.error + ")" : ""));
    }
    const details = parseJsonSafe(detailsRes.body);

    const titleText = details.title || details.name || details.original_title || details.original_name || "Unknown Title";
    const description = details.overview || "";
    const posterUrl = details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : "";

    if (!isTv) {
        return new MultimediaItem({
            title: titleText,
            url: url,
            posterUrl: posterUrl,
            type: "movie",
            description: description,
            episodes: [
                new Episode({
                    name: titleText,
                    url: url,
                    season: 1,
                    episode: 1
                })
            ]
        });
    }

    const seasons = details.seasons || [];
    const activeSeasons = seasons.filter(s => s && s.season_number > 0);
    const seasonPromises = activeSeasons.map(s => 
        httpGetWithRetry(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${s.season_number}?api_key=${apiKey}`)
    );

    const seasonResults = await Promise.all(seasonPromises);
    const episodes = [];

    for (let i = 0; i < activeSeasons.length; i++) {
        const s = activeSeasons[i];
        const sNum = s.season_number;
        const sRes = seasonResults[i];

        if (sRes && sRes.code === 200) {
            const sData = parseJsonSafe(sRes.body);
            const eps = sData.episodes || [];
            for (let eIdx = 0; eIdx < eps.length; eIdx++) {
                const ep = eps[eIdx];
                const epTitle = ep.name || `Episode ${ep.episode_number}`;
                const epNum = ep.episode_number;
                const epPoster = ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : posterUrl;
                const epUrl = `https://watch32to.com/watch/tv/${tmdbId}/${sNum}/${epNum}`;

                episodes.push(new Episode({
                    name: epTitle,
                    url: epUrl,
                    season: sNum,
                    episode: epNum,
                    posterUrl: epPoster
                }));
            }
        } else {
            console.warn(`Failed to fetch season ${sNum} details (HTTP ${sRes ? sRes.code : "unknown"}), using fallback generation.`);
            const epCount = s.episode_count || 0;
            const seasonPoster = s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : posterUrl;
            for (let epNum = 1; epNum <= epCount; epNum++) {
                episodes.push(new Episode({
                    name: `Episode ${epNum}`,
                    url: `https://watch32to.com/watch/tv/${tmdbId}/${sNum}/${epNum}`,
                    season: sNum,
                    episode: epNum,
                    posterUrl: seasonPoster
                }));
            }
        }
    }

    episodes.sort((a, b) =>
        a.season !== b.season ? a.season - b.season : a.episode - b.episode
    );

    return new MultimediaItem({
        title: titleText,
        url: url,
        posterUrl: posterUrl,
        type: "series",
        description: description,
        episodes: episodes
    });
}
