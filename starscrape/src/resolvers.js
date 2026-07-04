/**
 * Helper to extract sources from Videasy API.
 */
async function extractVideasy(server, tmdbId, imdbId, title, year, season, episode) {
    try {
        const encTitle = encodeURIComponent(title);
        let url = "";
        if (season === null || season === undefined) {
            url = `https://api.videasy.net/${server}/sources-with-title?title=${encTitle}&mediaType=movie&year=${year}&tmdbId=${tmdbId}&imdbId=${imdbId || ""}`;
        } else {
            url = `https://api.videasy.net/${server}/sources-with-title?title=${encTitle}&mediaType=tv&year=${year}&tmdbId=${tmdbId}&episodeId=${episode}&seasonId=${season}&imdbId=${imdbId || ""}`;
        }

        const res = await http_get(url);
        const encData = res.body;
        if (!encData || encData.length < 10) return [];

        const decRes = await http_post(
            "https://enc-dec.app/api/dec-videasy",
            { "Content-Type": "application/json" },
            JSON.stringify({ text: encData, id: Number(tmdbId) })
        );
        const decJson = JSON.parse(decRes.body);
        if (!decJson || !decJson.result || !decJson.result.sources) return [];

        const streams = [];
        const sources = decJson.result.sources;
        for (let i = 0; i < sources.length; i++) {
            const src = sources[i];
            if (!src.url) continue;

            streams.push(new StreamResult({
                url: src.url,
                source: `${server === "superflix" ? "SuperFlix" : "Videasy"} (${src.quality || "HD"})`,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
                }
            }));
        }
        return streams;
    } catch (e) {
        return [];
    }
}

/**
 * Helper to extract sources from VidLink API.
 */
async function resolveVidLink(tmdbId, isTv, season, episode) {
    try {
        const tokenRes = await http_get("https://enc-dec.app/api/enc-vidlink?text=" + tmdbId);
        const tokenData = JSON.parse(tokenRes.body);
        const token = tokenData.result;

        if (!token) return [];

        const apiUrl = isTv
            ? "https://vidlink.pro/api/b/tv/" + token + "/" + season + "/" + episode + "?multiLang=1"
            : "https://vidlink.pro/api/b/movie/" + token + "?multiLang=1";

        const headers = {
            "Origin": "https://vidlink.pro",
            "Referer": "https://vidlink.pro/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
        };

        const apiRes = await http_get(apiUrl, headers);
        const streamData = JSON.parse(apiRes.body);

        if (!streamData || !streamData.stream) return [];

        const qualities = streamData.stream.qualities || {};
        const captions = streamData.stream.captions || [];
        const subs = captions.map(c => ({
            url: c.url,
            label: c.language || "English",
            lang: c.language ? c.language.toLowerCase().substring(0, 3) : "eng"
        }));

        const streams = [];

        if (streamData.stream.playlist) {
            streams.push(new StreamResult({
                url: streamData.stream.playlist,
                source: "VidLink (Auto)",
                headers: headers,
                subtitles: subs
            }));
        }

        for (const q in qualities) {
            streams.push(new StreamResult({
                url: qualities[q].url,
                source: "VidLink (" + q + "p)",
                headers: headers,
                subtitles: subs
            }));
        }

        return streams;
    } catch (e) {
        return [];
    }
}
