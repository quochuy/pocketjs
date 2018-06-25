const logger = require('./logger');
const database = require('./mistdb');
const dsteem = require('dsteem');
const client = new dsteem.Client('https://api.steemit.com');
const _ = require('lodash');

const steemhelper = {
  config: require('../config/config.json'),
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
    },

    sanitizePermlink: function(permlink) {
      permlink = _.trim(permlink);
      permlink = permlink.replace(/_|\s|\./, "-");
      permlink = permlink.replace(/[^\w-]/, "");
      permlink = permlink.replace(/[^a-zA-Z0-9-]/, "");
      permlink = permlink.toLowerCase();

      return permlink;
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
        /*database.update_last_block(steemhelper.progress.last_processed_block_number);
        database.update_last_tx_id(steemhelper.progress.last_processed_transaction_id);
        database.update_interrupted(steemhelper.progress.interrupted);
        database.save();*/
      }
    }
    else {
      transaction.operations.forEach((operation) => {
        steemhelper.processOperation(blockTimestamp, operation, blockNumber, trxid, callback)
      });
      steemhelper.progress.last_processed_transaction_id = trxid;
      /*database.update_last_block(steemhelper.progress.last_processed_block_number);
      database.update_last_tx_id(steemhelper.progress.last_processed_transaction_id);
      database.update_interrupted(steemhelper.progress.interrupted);
      database.save();*/
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

    const postingKey = dsteem.PrivateKey.fromString(steemhelper.config.confirmer_key);

    (async function () {
      try {
        const result = await client.broadcast.vote({
          voter: steemhelper.config.confirmer_account,
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
   * @param commentPermlink
   */
  comment: function(post, comment, commentPermlink) {
    return new Promise(async function(resolve, reject) {
      if (
        steemhelper.config.mode.test === false
        && (
          !steemhelper.config.confirmer_account
          || steemhelper.config.confirmer_key
          || steemhelper.config.confirmer_account === ''
          || steemhelper.config.confirmer_key === ''
        )
      ) {
        let err = 'Missing posting key';
        reject(err);
      } else {
        try {
          if (post && comment) {
            let permlink = '';
            if (typeof commentPermlink !== "undefined") {
              permlink = commentPermlink;
            } else {
              permlink = steemhelper.formatter.commentPermlink(post.author, post.permlink);
            }

            const payload = {
              author: steemhelper.config.confirmer_account,
              permlink: permlink,
              parent_author: post.author,
              parent_permlink: post.permlink,
              title: '',
              body: comment,
              json_metadata: "{\"tags\":[\"" + post.category + "\"],\"app\":\"pocketjs\"}"
            };

            let res = {};
            if (steemhelper.config.mode.debug === false) {
              const postingKey = dsteem.PrivateKey.fromString(steemhelper.config.confirmer_key);
              res = await client.broadcast.comment(payload, postingKey);
              logger.log("[success][steemcomment]", payload, res);
            } else {
              logger.log("[DEBUG][steemcomment]", payload);
              res = {};
            }

            resolve({payload: payload, result: res});
          }
        } catch (err) {
          reject(err);
        }
      }
    });
  },

  /**
   * Extract author and permlink from a URI
   * @param url
   * @returns {{author: *, permlink: *}}
   */
  getAuthorPermlinkFromUrl: function(url) {
    const authorPermlink = url.split('@').pop().split('/');
    return {
      author: authorPermlink[0],
      permlink: authorPermlink[1]
    }
  },

  /**
   * Retreive the post data from the blockchain
   * @param author
   * @param permlink
   * @returns {Promise<*>}
   */
  getPost: async function(author, permlink) {
    try {
      const post = await client.database.call('get_content', [author, permlink]);
      return post;
    } catch(err) {
      logger.log("[error][getcontent]", err);
      return null;
    }
  },

  /**
   * Retreive all replies of a post from the blockchain
   * @param author
   * @param permlink
   * @returns {Promise<*>}
   */
  getReplies: async function(author, permlink) {
    try {
      const replies = await client.database.call('get_content_replies', [author, permlink]);
      return replies;
    } catch(err) {
      logger.log("[error][get_content_replies]", err);
      return null;
    }
  }
};

module.exports = steemhelper;
