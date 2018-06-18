const logger = {
  /**
   * Append date to the log
   */
  log: function () {
    const now = new Date();

    if (typeof arguments.unshift === 'undefined') {
      arguments[0] = now + ' ' + arguments[0];
    } else {
      arguments.unshift(now);
    }

    console.log.apply(null, arguments);
  }
};

module.exports = logger;