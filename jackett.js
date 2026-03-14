/**
 * Hayase Extension — Jackett
 *
 * Connects Hayase to a local Jackett instance via its JSON Results API.
 * Configure the URL, API key, and indexer in the extension options.
 *
 * Jackett JSON API endpoint used:
 *   GET /api/v2.0/indexers/{indexer}/results
 *       ?apikey=<key>&Query=<q>&Category[]=<cat>
 */
export default new class Jackett {
  // ─── Jackett JSON Results API ──────────────────────────────────────────────

  /**
   * Perform a search request against Jackett.
   *
   * @param {string}   query      - Search query string
   * @param {object}   options    - User-configured extension options
   * @param {string[]} categories - Torznab category IDs to filter by
   * @returns {Promise<TorrentResult[]>}
   */
  async _search(query, options, categories, fetchFn) {
    const base    = String(options?.url     || 'http://127.0.0.1:9117').replace(/\/$/, '')
    const apiKey  = String(options?.apikey  || '')
    const indexer = String(options?.indexer || 'all')

    const params = new URLSearchParams({ apikey: apiKey, Query: query })
    for (const cat of categories) {
      params.append('Category[]', cat)
    }

    const url = `${base}/api/v2.0/indexers/${indexer}/results?${params}`
    // Use Hayase-provided fetch to bypass mixed-content/CORS restrictions
    const res = await fetchFn(url)

    if (!res.ok) throw new Error(`Jackett: HTTP ${res.status} — check URL and API key`)

    const data = await res.json()
    return this._map(data.Results || [])
  }

  // ─── Result Mapping ─────────────────────────────────────────────────────────

  /**
   * Map Jackett result objects to the TorrentResult shape expected by Hayase.
   *
   * @param {object[]} results - Raw results from Jackett JSON API
   * @returns {TorrentResult[]}
   */
  _map(results) {
    return results
      .map(item => {
        // Prefer InfoHash; fall back to extracting btih from MagnetUri
        const hash = (
          item.InfoHash ||
          item.MagnetUri?.match(/btih:([a-fA-F0-9]+)/i)?.[1] ||
          ''
        ).toLowerCase()

        // Jackett exposes total peers; leechers = peers − seeders
        const seeders  = item.Seeders  || 0
        const peers    = item.Peers    || 0
        const leechers = Math.max(0, peers - seeders)

        return {
          title:     item.Title || '',
          link:      item.MagnetUri || item.Link || '',
          hash,
          seeders,
          leechers,
          downloads: item.Grabs || 0,
          size:      item.Size  || 0,
          date:      new Date(item.PublishDate || Date.now()),
          accuracy:  'medium',
        }
      })
      // Drop results without a usable link or hash
      .filter(r => r.link || r.hash)
  }

  // ─── Query Helpers ──────────────────────────────────────────────────────────

  /**
   * Build the best query string from the titles array + optional episode.
   * Uses the first title variant; Hayase already normalises these for us.
   *
   * @param {string[]} titles
   * @param {number|undefined} episode
   * @returns {string}
   */
  _buildQuery(titles, episode) {
    const title = titles[0] || ''
    const ep    = episode != null ? String(episode).padStart(2, '0') : ''
    return ep ? `${title} ${ep}` : title
  }

  // ─── Required Extension Methods ─────────────────────────────────────────────

  /**
   * Search for a single episode.
   * Torznab categories: 5070 (TV/Anime), 5000 (TV)
   *
   * @param {TorrentQuery} query
   * @param {object}       options
   * @returns {Promise<TorrentResult[]>}
   */
  async single({ titles, episode, fetch: fetchFn }, options) {
    if (!titles?.length) return []
    const q = this._buildQuery(titles, episode)
    return this._search(q, options, ['5070', '5000'], fetchFn)
  }

  /**
   * Search for a full season / batch release.
   * Strips the episode number so we match season packs.
   *
   * @param {TorrentQuery} query
   * @param {object}       options
   * @returns {Promise<TorrentResult[]>}
   */
  async batch({ titles, fetch: fetchFn }, options) {
    if (!titles?.length) return []
    return this._search(titles[0], options, ['5070', '5000'], fetchFn)
  }

  /**
   * Search for a movie.
   * Torznab categories: 2000 (Movies), 2010 (Foreign), 2020 (Other)
   *
   * @param {TorrentQuery} query
   * @param {object}       options
   * @returns {Promise<TorrentResult[]>}
   */
  async movie({ titles, fetch: fetchFn }, options) {
    if (!titles?.length) return []
    return this._search(titles[0], options, ['2000', '2010', '2020'], fetchFn)
  }

  /**
   * Basic connectivity test against the configured (or default) Jackett URL.
   * Called by Hayase before showing the extension as active.
   *
   * NOTE: test() does not receive options, so we probe the default address.
   * If you run Jackett on a non-default port, the extension will still work
   * for searches — only this indicator may show as unavailable.
   *
   * @returns {Promise<boolean>}
   */
  async test() {
    try {
      // /server/config redirects to login UI; use Torznab caps instead — always 200
      const res = await fetch(
        'http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/api?t=caps',
        { signal: AbortSignal.timeout(5000) },
      )
      return res.ok
    } catch {
      return false
    }
  }
}()
