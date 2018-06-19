var steemHelper = require('./utils/steemhelper');
var constants = require("./utils/constants");

var app = {
  config: require('./config.json'),
  db: require('./utils/db'),

  run: function() {
    app.db.init();

  }
};

app.run();