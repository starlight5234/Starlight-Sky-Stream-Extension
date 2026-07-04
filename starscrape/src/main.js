/**
 * Loads the home screen categories.
 * @param {(res: Response) => void} cb
 */
async function getHome(cb) {
    try {
        const data = await fetchHomeCategories();
        cb({ success: true, data: data });
    } catch (e) {
        cb({ success: false, errorCode: "HOME_ERROR", message: e.stack || String(e) });
    }
}

/**
 * Searches for media items using TMDB multi-search.
 * @param {string} query
 * @param {number} page
 * @param {(res: Response) => void} cb
 */
async function search(query, page, cb) {
    let realPage = 1;
    let realCb = cb;

    if (typeof page === "function") {
        realCb = page;
        realPage = 1;
    } else if (typeof page === "number") {
        realPage = page;
    }

    try {
        const items = await searchMedia(query, realPage);
        if (realCb) realCb({ success: true, data: items });
    } catch (e) {
        if (realCb) realCb({ success: false, errorCode: "SEARCH_ERROR", message: e.stack || String(e) });
    }
}

/**
 * Loads details and complete season/episode list for a specific media item.
 * @param {string} url
 * @param {(res: Response) => void} cb
 */
async function load(url, cb) {
    try {
        const details = await fetchMediaDetails(url);
        cb({ success: true, data: details });
    } catch (e) {
        cb({ success: false, errorCode: "LOAD_ERROR", message: e.stack || String(e) });
    }
}

/**
 * Resolves streams for a specific media item or episode.
 * Resolves from VidLink, SuperFlix, and Videasy in parallel.
 * @param {string} url
 * @param {(res: Response) => void} cb
 */
async function loadStreams(url, cb) {
    try {
        const apiKey = TMDB_API_KEY;
        let tmdbId = "", season = null, episode = null, isTv = false;

        if (url.includes('/tv/')) {
            isTv = true;
            const watchMatch = url.match(/\/watch\/tv\/(\d+)\/(\d+)\/(\d+)/);
            if (watchMatch) {
                tmdbId = watchMatch[1];
                season = parseInt(watchMatch[2]);
                episode = parseInt(watchMatch[3]);
            } else {
                const legacyMatch = url.match(/season\/(\d+).*episode\/(\d+)/) || url.match(/[-_][sS](\d+)[-_][eE](\d+)/);
                if (legacyMatch) {
                    season = parseInt(legacyMatch[1]);
                    episode = parseInt(legacyMatch[2]);
                }
                const idMatch = url.match(/\/(?:movie|tv)\/(?:[^/]*?-)?(\d+)/);
                if (idMatch) tmdbId = idMatch[1];
            }
        } else {
            const idMatch = url.match(/\/(?:movie|tv)\/(?:[^/]*?-)?(\d+)/);
            if (idMatch) tmdbId = idMatch[1];
        }

        if (!tmdbId) {
            return cb({ success: false, message: "Could not parse TMDB ID from url: " + url });
        }

        // Fetch details from TMDB to obtain required metadata for alternative resolvers
        const type = isTv ? "tv" : "movie";
        const detailsRes = await http_get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}&append_to_response=external_ids`);
        const details = JSON.parse(detailsRes.body);

        const title = details.title || details.name || details.original_title || details.original_name || "";
        const year = (details.release_date || details.first_air_date || "").substring(0, 4);
        const imdbId = details.external_ids ? details.external_ids.imdb_id : (details.imdb_id || "");

        // Fetch from all sources in parallel
        const streamPromises = [
            resolveVidLink(tmdbId, isTv, season, episode),
            extractVideasy("superflix", tmdbId, imdbId, title, year, season, episode),
            extractVideasy("overflix", tmdbId, imdbId, title, year, season, episode)
        ];

        const results = await Promise.all(streamPromises);
        const streams = results.flat();

        if (streams.length === 0) {
            return cb({ success: false, message: "No streams found from any of the sources" });
        }

        cb({ success: true, data: streams });
    } catch (e) {
        cb({ success: false, errorCode: "STREAM_ERROR", message: e.stack || String(e) });
    }
}

globalThis.getHome = getHome;
globalThis.search = search;
globalThis.load = load;
globalThis.loadStreams = loadStreams;
