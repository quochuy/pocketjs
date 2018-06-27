const pcache = require('persistent-cache');

const cache = {
  _cache: null,

  /**
   * Init the cache
   * @param cacheName
   * @param ttl
   * @param base
   */
  init: function(cacheName, ttl, base) {
    if (typeof ttl === "undefined") {
      ttl = 1000 * 3600 * 24;
    }

    const cacheOptions = {};

    if (ttl !== 0) {
      cacheOptions.duration = ttl;
    }

    if (typeof base !== "undefined") {
      cacheOptions.base = base;
    }

    if(typeof cacheName !== "undefined") {
      cacheOptions.name = cacheName;
    }

    cache._cache = new pcache(cacheOptions);
  },

  /**
   * Save cache
   * @param id
   * @param payload
   */
  set: function(id, payload) {
    if (typeof payload !== "string") {
      payload = JSON.stringify(payload);
    }

    cache._cache.putSync(id, payload);
  },

  /**
   * Load cache
   * @param id
   * @param asObject
   * @returns {*}
   */
  get: function(id, asObject) {
    const data = cache._cache.getSync(id);

    if (asObject && data) {
      return JSON.parse(data);
    }

    return data;
  }
};

module.exports = cache;
