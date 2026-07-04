const TMDB_API_KEY = "TMDB_API_KEY_PLACEHOLDER";

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

    const trendingData = JSON.parse(results[0].body).results || [];
    const moviesData = JSON.parse(results[1].body).results || [];
    const tvData = JSON.parse(results[2].body).results || [];

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

    const res = await http_get(searchUrl);
    const data = JSON.parse(res.body);
    const results = data.results || [];

    return results
        .filter(item => item.media_type === "movie" || item.media_type === "tv")
        .map(item => parseTmdbItem(item));
}

/**
 * Fetches movie/show details including TV seasons and episodes.
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
    const detailsRes = await http_get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}`);
    const details = JSON.parse(detailsRes.body);

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
    const seasonRequests = seasons
        .map(s => s.season_number)
        .filter(n => n > 0)
        .map(sNum => ({
            url: `https://api.themoviedb.org/3/tv/${tmdbId}/season/${sNum}?api_key=${apiKey}`,
            method: "GET",
            headers: {}
        }));

    const seasonResults = await http_parallel(seasonRequests);
    const episodes = [];

    for (let sIdx = 0; sIdx < seasonResults.length; sIdx++) {
        const sData = JSON.parse(seasonResults[sIdx].body);
        const sNum = sData.season_number;
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
