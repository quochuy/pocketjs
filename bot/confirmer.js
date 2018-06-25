const steemHelper = require('./utils/steemhelper');
const voter = require('./utils/voter');
const validator = require('./utils/validator');
const database = require('./utils/mistdb');
const constants = require('./utils/constants');
const confirmation = require('./utils/confirmation');
const logger = require('./utils/logger');
const moment = require('moment');

const app = {
  config: require('./config/config.json'),
  exitNow: false,
  confirmationWaitTime: 21,
  lastConfirmationTime: 0,

  gracefulExit: function(e) {
    console.log("Graceful exit", e);

    database.save();
    voter.save();
    app.exitNow = true;

    setTimeout(function() {
      process.exit()
    }, 2000);
  },

  processOperation: function(operation, blockNumber, trxid) {
    const mist_op = validator.parseOP(
      operation,
      trxid,
      database,
    );

    if (mist_op !== null) {
      const op_is_valid = database.add_op(mist_op); // adds if it's valid
      console.log(JSON.stringify(mist_op) + " valid: " + op_is_valid.toString());

      if (op_is_valid) {
        if (mist_op.type !== 'confirmation') {
          database.enqueue_for_confirmation(mist_op, operation);
        } else {
          voter.mark_for_voting(operation);
        }
      }
    }

    if (database.genesis_active()) {
      if (database.past_genesis_interval(this_block)) {
        database.deactivate_genesis()
      } else {
        // watch for reblogs of genesis post
        if (operation[0] === 'custom_json') {
          payload = json.loads(operation[1].json)
          if (payload[0] === 'reblog') {
            if (payload[1].author === constants.GENESIS_ACCOUNT) {
              if (payload[1].permlink === 'genesis-' + constants.TOKEN_NAME) {
                if (database.is_eligible(payload[1].account)) {
                  database.credit_genesis(payload[1].account);
                }
              }
            }
          }
        }
      }
    }
  },

  processPreGenesisOperation: function(operation, blockNumber, trxid) {
    if (operation[0] === 'comment') {
      if(!database.is_eligible(operation[1].author)) {
        database.increment_comment_count(operation[1].author)
      }

      // watch for genesis activation
      if (operation[1].author === constants.GENESIS_ACCOUNT) {
        if (operation[1].title === 'genesis-'+constants.TOKEN_NAME) {
          database.activate_genesis(blockNumber);
          database.activate();
          database.credit_genesis(constants.GENESIS_ACCOUNT);
        }
      }
    }
  },

  postProcessing: function(blockNumber) {
    database.update_last_block(blockNumber);

    if (blockNumber % constants.SAVE_INTERVAL === 0) {
      database.save();
      voter.save();
    }

    if (blockNumber % 100000 === 0) {
      console.log(blockNumber);
    }

    if (app.exitNow === true) {
      process.exit();
    }
  },

  processPendingConfirmations: function() {
    if (app.config.confirmation_active && database.active()) {
      const today = moment(Date.now());
      const diff = today.diff(app.lastConfirmationTime, 'seconds');
      if (
        app.lastConfirmationTime === 0
        || diff >= app.confirmationWaitTime
      ) {
        logger.log("process pending confirmation");
        const confirm = database.get_next_confirmation();

        if (confirm !== null) {
          confirmation.confirm_op(confirm[0], confirm[1]);
          app.lastConfirmationTime = moment(Date.now());
        }
      }
    }
  },

  run: function() {
    database.init();
    voter.init();

    process.on('SIGINT', app.gracefulExit);
    process.on('uncaughtException', app.gracefulExit);

    const from = database.last_parsed_block();

    steemHelper.processBlockChain(
      from || 23447023,
      function(blockTimestamp, operation, blockNumber, trxid) {
        if (database.active()) {
          app.processOperation(operation, blockNumber, trxid);
        } else { // Not active, we're pre-genesis
          app.processPreGenesisOperation(operation, blockNumber, trxid);
        }

        app.postProcessing(blockNumber);
        app.processPendingConfirmations();
      },

      function() {
        console.log('[error]');
      }
    );
  }
};

app.run();