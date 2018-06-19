var steemHelper = require('./utils/steemhelper');

var app = {
  config: require('./config.json'),
  db: require('./utils/db'),

  run: function() {
    app.db.init();
    steemHelper.processBlockChain(
      23447023,
      function(blockTimestamp, operation) {
        console.log(blockTimestamp, operation);
        process.exit();
      },

      function() {
        console.log('[error]');
      }
    );
  }
};

app.run();