module.exports = {
  /**
   * Shuffles array in place. ES6 version
   * @param {Array} a items An array containing the items.
   */
  shuffle: function (a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  settlePromises: function (arr){
    return Promise.all(arr.map(promise => {
      return promise.then(
        value => ({state: 'resolved', value}),
        value => ({state: 'rejected', value})
      );
    }));
  },

  /**
   * Go to sleep with promise
   * @param ms
   * @returns {Promise<any>}
   */
  sleep: function(ms) {
    return new Promise(function(resolve, reject) {
      setTimeout(resolve, ms);
    });
  }
};