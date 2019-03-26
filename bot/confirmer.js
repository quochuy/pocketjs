const steemHelper = require('./utils/steemhelper');
const voter = require('./utils/voter');
const validator = require('./utils/validator');
const database = require('./utils/mistdb');
const constants = require('./utils/constants');
const confirmation = require('./utils/confirmation');
const logger = require('./utils/logger');
const moment = require('moment');
const cache = require('./utils/cache');

const app = {
  config: require('./config/config.json'),
  exitNow: false,
  confirmationWaitTime: 21,
  lastConfirmationTime: 0,
  cliOptionsDefinitions: [
    { name: 'replay-from-genesis', alias: 'g', type: Boolean },
    { name: 'replay-from-0', alias: 'z', type: Boolean },
    { name: 'use-jussi', alias: 'j', type: Boolean }
  ],
  cliOptions: null,

  gracefulExit: function(e) {
    logger.log("Graceful exit");

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
      blockNumber
    );

    if (mist_op !== null) {
      const op_is_valid = database.add_op(mist_op); // adds if it's valid
      logger.log(JSON.stringify(mist_op) + " valid: " + op_is_valid.toString());

      if (op_is_valid) {
        if (mist_op.type !== 'confirmation') {
          database.enqueue_for_confirmation(mist_op, operation);
        } else {
          voter.mark_for_voting(operation);
        }
      }
    }
  },

  processPreGenesisOperation: function(operation, blockNumber) {
    if (operation[0] === 'comment') {
      if(!database.is_eligible(operation[1].author)) {
        logger.log(operation[1].author, 'not eligible yet');
        database.increment_comment_count(operation[1].author)
      }

      // watch for genesis activation
      if (operation[1].author === constants.GENESIS_ACCOUNT) {
        console.log(operation[1].author, 'is genesis account');
        if (operation[1].title === 'genesis-'+constants.TOKEN_NAME) {
          logger.log("Genesis post found, activating DB");
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
      logger.log(blockNumber);
    }

    if (app.exitNow === true) {
      process.exit();
    }
  },

  processFoundOperation: function(blockTimestamp, operation, block, trxid) {
    if (database.active()) {
      app.processOperation(operation, block.value, trxid);
    } else { // Not active, we're pre-genesis
      app.processPreGenesisOperation(operation, block.value, trxid);
    }

    app.postProcessing(block.value);
    app.processPendingConfirmations();
  },

  processPendingConfirmations: function() {
    if (app.config.confirmation_active && database.active()) {
      const today = moment(Date.now());
      const diff = today.diff(app.lastConfirmationTime, 'seconds');
      if (
        app.lastConfirmationTime === 0
        || diff >= app.confirmationWaitTime
      ) {
        const confirm = database.get_next_confirmation();

        if (confirm !== null) {
          logger.log("process pending confirmation");

          confirmation.confirm_op(confirm[0], confirm[1]);
          app.lastConfirmationTime = moment(Date.now());
        }
      }
    }
  },

  run: async function() {
    logger.log("===== INIT =====");
    let startupBehavior = 'normal';
    const commandLineArgs = require('command-line-args');

    try {
      const currentBlockNumber = await steemHelper.connectToRpcNode();
      if (!currentBlockNumber) {
        app.gracefulExit();
      }

      logger.log("===== CONNECTED =====");

      process.on('SIGINT', app.gracefulExit);
      process.on('uncaughtException', app.gracefulExit);

      cache.init('pocketjs', 3600000);
      database.init();
      voter.init();

      app.cliOptions = commandLineArgs(app.cliOptionsDefinitions);
      if (app.cliOptions["replay-from-genesis"] === true) {
        console.log('Replaying from genesis, loading pre-built DB...');
        database.load('./database/db_pregenesis.json');
        database.save();
      } else if (app.cliOptions["replay-from-0"] === true) {
        database.reset();
      }

      const lastParsedBlock = database.last_parsed_block();
      logger.log("Processing blocks from #" + lastParsedBlock);

      logger.log("===== START =====");

      steemHelper.processBlockChain(
        lastParsedBlock || 1,
        currentBlockNumber,
        app.processFoundOperation,
        app.cliOptions["use-jussi"]
      );
    } catch(err) {
      logger.log("[error]", err);
    }
  }
};

app.run();