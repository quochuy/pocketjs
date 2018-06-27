const assert = require('assert');

describe('Cache', function() {
  it('should save to cache with expiration', function() {
    const cache = require('../utils/cache');
    const payload = {testData: 123};
    const cacheKey = "test";
    cache.init('test', 2000);
    cache.set(cacheKey, payload);

    const cacheData = cache.get(cacheKey);
    assert.equal(cacheData, JSON.stringify(payload));
  });
});