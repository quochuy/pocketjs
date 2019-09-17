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
  minimumRc: 250,

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
          if (steemHelper.isCatchingUp === false) {
            voter.mark_for_voting(operation);
          } else {
            logger.log("Confirmation upvotes are disabled during replay or from the config file");
          }
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
        logger.log(operation[1].author, 'is genesis account');
        if (operation[1].title === 'genesis-'+constants.TOKEN_NAME) {
          logger.log("Genesis post found, activating DB");
          database.activate_genesis(blockNumber);
          database.activate();
          database.credit_genesis(constants.GENESIS_ACCOUNT);
        }
      }
    }
  },

  postProcessing: async function(blockNumber) {
    database.update_last_block(blockNumber);

    if (blockNumber % constants.SAVE_INTERVAL === 0) {
      logger.log("Saving DB to disk");
      database.save();
      voter.save();
    }

    if (blockNumber % 100000 === 0) {
      logger.log(`Reached block #${blockNumber}`);
    }

    // This is set to true when receving a SIGINT
    // We will exit when the current block has been processed
    if (app.exitNow === true) {
      process.exit();
    }

    // It takes too long to check confirmations, if SIGING is received
    // we will check this one next time
    await app.processPendingConfirmations();
  },

  processFoundOperation: function(blockTimestamp, operation, block, trxid) {
    if (database.active()) {
      app.processOperation(operation, block.value, trxid);
    } else { // Not active, we're pre-genesis
      app.processPreGenesisOperation(operation, block.value, trxid);
    }
  },

  processPendingConfirmations: async function() {
    if (app.config.confirmation_active && database.active()) {
      const today = moment(Date.now());
      const diff = today.diff(app.lastConfirmationTime, 'seconds');

      if (
        (app.lastConfirmationTime === 0 || diff >= app.confirmationWaitTime)
        && app.config.confirmation_active === true
        && steemHelper.isCatchingUp === false
      ) {
        const confirm = database.get_next_confirmation();

        if (confirm !== null) {
          try {
            const confirmationComment = await confirmation.confirm_op(confirm[0], confirm[1]);
            if (confirmationComment !== false) {
              try {
                const rc = await steemHelper.getRcMana('pocketjs');
                if (rc.percentage >= app.minimumRc) {
                  const result = await steemHelper.comment(
                    confirmationComment.parentPermLink,
                    confirmationComment.body,
                    confirmationComment.permlink);

                  cache.set(confirmationComment.permlink, result);
                  app.lastConfirmationTime = moment(Date.now());
                  logger.log(`Confirmation comment in block #${result.result.block_num}`);
                } else {
                  logger.log(`RC too low: ${rc.percentage / 100}%`);
                }
              } catch(err) {
                logger.log(err);
              }
            } else {
              // Already confirmed
            }
          } catch(err) {
            logger.log(err);
          }
        }
      } else {
        if (app.config.mode.debug >= 1) {
          if  (steemHelper.isCatchingUp === true) {
            logger.log("Too soon to confirm or disabled by config or due to replay");
          } else if (app.config.confirmation_active === false) {
            logger.log("Confirmation disabled");
          } else {
            logger.log("Confirmed less than 20 seconds ago, need to wait");
          }
        }
      }
    }

    return true;
  },

  run: async function() {
    logger.log("===== INIT =====");
    let startupBehavior = 'normal';
    const commandLineArgs = require('command-line-args');

    try {
      const headBlockData = await steemHelper.connectToRpcNode();
      if (!headBlockData) {
        logger.log("[error] No headblock...");
        app.gracefulExit();
      }

      logger.log("===== CONNECTED =====");

      process.on('SIGINT', app.gracefulExit);
      process.on('uncaughtException', function(e) {
        console.log("Uncaught", e);
        app.gracefulExit();
      });

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
        headBlockData.currentBlockNum,
        app.processFoundOperation,
        app.postProcessing,
        app.cliOptions["use-jussi"])
        .catch(function(err) {
          logger.log("[error][app.run]", err);
        });

    } catch(err) {
      logger.log("[error]", err);
    }
  }
};

app.run();