const logger = require('./logger');
const database = require('./db');
const dsteem = require('dsteem');
const client = new dsteem.Client('https://api.steemit.com');

const steemhelper = {
  config: require('../config.json'),
  progress: {},
  formatter: {
    /**
     * Generate a new permlink for a comment based on the parent post
     *
     * @param parentAuthor
     * @param parentPermlink
     * @returns {string}
     */
    commentPermlink: function (parentAuthor, parentPermlink) {
      const timeStr = new Date()
        .toISOString()
        .replace(/[^a-zA-Z0-9]+/g, "")
        .toLowerCase();
      parentPermlink = parentPermlink.replace(/(-\d{8}t\d{9}z)/g, "");
      return "re-" + parentAuthor + "-" + parentPermlink + "-" + timeStr;
    }
  },

  /**
   * @param block_number      Start at this block number or start at the blockchain head
   * @param callback          Callback function to receive matching posts
   * @param error_callback    Error callback function
   * @returns {Promise<void>}
   */
  processBlockChain: async function (block_number, callback, error_callback = null) {
    steemhelper.last_processed_transaction_id = database.last_tx_id();
    steemhelper.last_processed_block_number = database.last_parsed_block();
    steemhelper.interrupted = database.was_interrupted();

    if (typeof callback === "function") {
      let iterator = await client.blockchain.getBlockNumbers(block_number);
      steemhelper.processNextBlock(iterator, callback, error_callback);
    } else {
      throw "Callback is not a function";
    }
  },

  /**
   * Get a block and process its transactions
   *
   * @param iterator
   * @param callback
   * @param error_callback
   * @returns {Promise<void>}
   */
  processNextBlock: async function (iterator, callback, error_callback) {
    let current_block_number, previous_block_number;
    while (true) {
      try {
        current_block_number = await iterator.next();
        if (current_block_number.value < database.last_parsed_block()) {
          if (steemhelper.config.mode.debug >= 2) {
            logger.log(`[Debug][processTransaction]Skipped already processed block with number: ${current_block_number.value}`);
          }
          continue;
        }
        let block = await client.database.getBlock(current_block_number.value);
        if (steemhelper.config.mode.debug >= 1) {
          logger.log('[Debug][block_number]', current_block_number);
          logger.log('[Debug][time_stamp]', block.timestamp);
        }
        block.transactions.forEach((transaction) => {
          steemhelper.processTransaction(block.timestamp, current_block_number, transaction, callback)
        });
        previous_block_number = current_block_number.value;

        database.update_last_block(previous_block_number);
        database.save();

        if (steemhelper.config.mode.debug >= 1) {
          logger.log(`[Debug][Progress] Finished Processing block number ${previous_block_number}`);
        }
      }
      catch (error) {
        logger.log("[Error][examine_block]", error);
        logger.log("[Error][examine_block][current_block_number]", current_block_number.value);
        logger.log("[Error][examine_block][previous_block_number]", previous_block_number.value);
        if (typeof error_callback === 'function') {
          error_callback();
        }
        else {
          break;
        }
      }
    }
  },

  /**
   * Extract operations from a transaction and process them
   *
   * @param blockTimestamp
   * @param transaction
   * @param callback
   * @returns {Promise<void>}
   */
  processTransaction: async function (blockTimestamp, blockNumber, transaction, callback) {
    let trxid = transaction.hasOwnProperty('transaction_id') ? transaction.transaction_id : null
    if (steemhelper.progress.interrupted) {
      if (steemhelper.config.mode.debug >= 2) {
        logger.log(`[Debug][processTransaction]Skipped already processed transaction with ID: ${trxid}`);
      }
      if (steemhelper.progress.last_processed_transaction_id === trxid) {
        steemhelper.progress.interrupted = false;
        database.update_last_block(steemhelper.progress.last_processed_block_number);
        database.update_last_tx_id(steemhelper.progress.last_processed_transaction_id);
        database.update_interrupted(steemhelper.progress.interrupted);
        database.save();
      }
    }
    else {
      transaction.operations.forEach((operation) => {
        steemhelper.processOperation(blockTimestamp, operation, blockNumber, trxid, callback)
      });
      steemhelper.progress.last_processed_transaction_id = trxid;
      database.update_last_block(steemhelper.progress.last_processed_block_number);
      database.update_last_tx_id(steemhelper.progress.last_processed_transaction_id);
      database.update_interrupted(steemhelper.progress.interrupted);
      database.save();
      if (steemhelper.config.mode.debug >= 2) {
        logger.log(`[Debug][Progress] Finished Processing transaction with ID ${trxid}`);
      }
    }
  },

  /**
   * Search for "comment" type operations
   *
   * @param blockTimestamp
   * @param operation
   * @param callback
   * @returns {Promise<void>}
   */
  processOperation: async function (blockTimestamp, operation, blockNumber, trxid, callback) {
    if (operation && operation[0] && operation[0].toLowerCase() === 'comment' && operation[1]) {
      if (typeof callback === 'function') {
        callback(blockTimestamp, operation, blockNumber, trxid);
      }
    }
  },

  /**
   * Upvote a post
   *
   * @param author
   * @param permlink
   * @param weight
   * @param callback
   */
  upvote: function (author, permlink, weight, callback, errorCallback) {
    if (typeof weight === 'undefined') {
      weight = 10000;
    }

    const postingKey = dsteem.PrivateKey.fromString(steemhelper.config.bot.steem.postingKey);

    (async function () {
      try {
        const result = await client.broadcast.vote({
          voter: steemhelper.config.bot.steem.account,
          author: author,
          permlink: permlink,
          weight: weight
        }, postingKey);

        if (typeof callback === "function") {
          callback(result);
        }
      } catch (error) {
        logger.log("[Error][broadcast_vote]", error);

        if (error.indexOf('You have already voted in a similar way')) {
          logger.log("Already voted");
        }

        if (typeof errorCallback === "function") {
          errorCallback(error);
        }
      }
    }());
  },

  /**
   * Comment on a post
   *
   * @param post
   * @param comment
   */
  comment: function(post, comment) {
    return new Promise(async function(resolve, reject) {
      if (
        !steemhelper.config.bot.steem.account
        || steemhelper.config.bot.steem.postingKey
        || steemhelper.config.bot.steem.account === ''
        || steemhelper.config.bot.steem.postingKey === ''
      ) {
        let err = 'Missing posting key';
        reject(err);
      } else {
        try {
          if (post && comment) {
            const permlink = steemhelper.formatter.commentPermlink(post.author, post.permlink);
            const payload = {
              author: steemhelper.config.bot.steem.account,
              permlink: permlink,
              parent_author: post.author,
              parent_permlink: post.permlink,
              title: '',
              body: comment,
              json_metadata: "{\"tags\":[\"" + post.category + "\"],\"app\":\""+ steemhelper.config.bot.steem.account +"\"}"
            };

            const postingKey = dsteem.PrivateKey.fromString(steemhelper.config.bot.steem.postingKey);
            const res = await client.broadcast.comment(payload, postingKey);
            logger.log("[success][steemcomment]", payload, res);

            resolve({payload: payload, result: res});
          }
        } catch (err) {
          reject(err);
        }
      }
    });
  },

  getAuthorPermlinkFromUrl: function(url) {
    const authorPermlink = url.split('@').pop().split('/');
    return {
      author: authorPermlink[0],
      permlink: authorPermlink[1]
    }
  },

  getPost: async function(author, permlink) {
    try {
      const post = await client.database.call('get_content', [author, permlink]);
      return post;
    } catch(err) {
      logger.log("[error][getcontent]", err);
      return null;
    }
  }
};

module.exports = steemhelper;
