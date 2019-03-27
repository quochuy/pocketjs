const logger = require('./logger');
const database = require('./mistdb');
const dsteem = require('dsteem');
const _ = require('lodash');
const jussi = require('./steem-jussi');
const tools = require('./tools');
let client;

const steemhelper = {
  config: require('../config/config.json'),
  progress: {},
  blockIterator: null,

  firstNodeToRespond: function(nodes) {
    return new Promise(function(resolve, reject) {
      let nbFailed = 0;
      nodes.forEach(function(node) {
        node.promise
          .then(function(currentBlockNumber) {
            node.currentBlockNum = currentBlockNumber;
            resolve(node);
          })
          .catch(function(node) {
            return function() {
              nbFailed++;
              logger.log(`Failed connecting to ${node.name}`);
              if(nbFailed === nodes.length) {
                reject();
              }
            }
          }(node))
      });
    });
  },

  /**
   *
   * @param logger.log
   * @returns {Promise}
   */
  connectToRpcNode: function() {
    return new Promise(async function(resolve, reject) {
      let nodes = [
        "https://api.steemit.com",
        "https://api.steem.house",
        "https://rpc.steemviz.com",
        "https://steemd.minnowsupportproject.org",
        "https://anyx.io"
      ];

      nodes = tools.shuffle(nodes);

      logger.log("Looking for a working RPC node");

      steemhelper.rpcConnected = false;
      let pendingNodes = [];

      for (let ni=0; ni<nodes.length; ni++) {
        const node = nodes[ni];
        const localClient = new dsteem.Client(node, {timeout: 10000});

        logger.log(`Trying ${node}`);

        pendingNodes.push({
          name: node,
          client: localClient,
          promise: localClient.blockchain.getCurrentBlockNum()
        });
      }

      try {
        let selectedNode = await steemhelper.firstNodeToRespond(pendingNodes);
        if (selectedNode.currentBlockNum !== null) {
          logger.log(`Connected to ${selectedNode.name}`);
          logger.log(`Head block number: ${selectedNode.currentBlockNum}`);

          client = selectedNode.client;
          steemhelper.rpcConnected = true;

          resolve({
            rpc: selectedNode.name,
            currentBlockNum: selectedNode.currentBlockNum
          });
        } else {
          reject("Failed fetching current block number");
        }
      } catch(err) {
        logger.log(err);
        reject("Failed connecting to RPC");
      }
    });
  },

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
   * @param startBlockNumber      Start at this block number or start at the blockchain head
   * @param callback          Callback function to receive matching posts
   * @param useJussi   Use Jussi to batch block requests
   * @returns {Promise<void>}
   */
  processBlockChain: async function (startBlockNumber, currentBlockNumber, callback, useJussi = false) {
    steemhelper.last_processed_transaction_id = database.last_tx_id();
    steemhelper.last_processed_block_number = database.last_parsed_block();
    steemhelper.interrupted = database.was_interrupted();

    let replay = false;

    if (typeof callback === "function") {
      let keepLooping = true;
      try {
        while (keepLooping !== false) {
          if (startBlockNumber < currentBlockNumber) {
            replay = true;
          }

          let blocks = [];

          if (useJussi === true) {
            blocks = await jussi.getBlocks(startBlockNumber);
            startBlockNumber += blocks.length;
          }  else {
            blocks = await steemhelper.getNextBlocks(startBlockNumber);
          }

          for(let bi=0; bi<blocks.length; bi++) {
            const block = blocks[bi];

            if (block.hasOwnProperty('transactions') && block.transactions.length > 0) {
              const blockNumber = block.transactions[0].block_num;

              if (blockNumber.value < database.last_parsed_block()) {
                if (steemhelper.config.mode.debug >= 2) {
                  logger.log(`[Debug][processTransaction]Skipped already processed block with number: ${currentBlockNumber.value}`);
                }
              }
              steemhelper.processBlock(block, callback);
            }
          }
        }
      } catch(err) {
        throw "Error fetching blocks " + err
      }
    } else {;
      throw "Callback is not a function";
    }
  },
  
  getNextBlocks: async function(block_number) {
    if (steemhelper.blockIterator === null) {
      steemhelper.blockIterator = await client.blockchain.getBlocks(block_number);
    }

    try {
      const iteratorResponse = await steemhelper.blockIterator.next();
      const block = iteratorResponse.value;

      return [block];
    } catch (error) {
      logger.log("[Error][examine_block]", error);
      logger.log("[Error][examine_block][current_block_number]", current_block_number.value);
      logger.log("[Error][examine_block][previous_block_number]", previous_block_number);

      if (
        error.message.indexOf("Cannot read property") !== -1
        || error.message.indexOf("network timeout") !== -1
        || error.message.indexOf("Unable to acquire database lock") !== -1
        || error.message.indexOf("Internal Error") !== -1
        || error.message.indexOf("HTTP 50") !== -1
      ) {
        currentBlockNumber = await steemhelper.connectToRpcNode();
        if (currentBlockNumber) {
          steemhelper.blockIterator = await client.blockchain.getBlocks(database.last_parsed_block());
        } else {
          throw "Lost connection to RPC and cannot reconnect";
        }
      } else {
        throw `Unknown error ${e.message}`;
      }
    }

  },

  /**
   * Get a block and process its transactions
   *
   * @param callback
   * @returns {Promise<void>}
   */
  processBlock: async function (block, callback) {
    const blockNumber = block.transactions[0].block_num;
    if (steemhelper.config.mode.debug >= 1) {
      logger.log('[Debug][block_number]', blockNumber);
      logger.log('[Debug][time_stamp]', block.timestamp);
    }

    block.transactions.forEach((transaction) => {
      steemhelper.processTransaction(block.timestamp, blockNumber, transaction, callback)
    });
    previous_block_number = blockNumber;

    database.update_last_block(previous_block_number);
    database.save();

    if (steemhelper.config.mode.debug >= 1) {
      logger.log(`[Debug][Progress] Finished Processing block number ${previous_block_number}`);
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
      }
    }
    else {
      transaction.operations.forEach((operation) => {
        steemhelper.processOperation(blockTimestamp, operation, blockNumber, trxid, callback)
      });
      steemhelper.progress.last_processed_transaction_id = trxid;
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
    if (
      operation
      && operation[0]
      && (
        operation[0].toLowerCase() === 'comment'
        || operation[0].toLowerCase() === 'custom_json'
      )
      && operation[1]) {
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
  upvote: async function (author, permlink, weight, callback, errorCallback) {
    if (typeof weight === 'undefined') {
      weight = 10000;
    }

    const postingKey = dsteem.PrivateKey.fromString(steemhelper.config.confirmer_key);

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
          steemhelper.config.confirmer_account
          && steemhelper.config.confirmer_key
          && steemhelper.config.confirmer_account !== ''
          && steemhelper.config.confirmer_key !== ''
        )
      ) {
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
            if (steemhelper.config.mode.test === false) {
              const postingKey = dsteem.PrivateKey.fromString(steemhelper.config.confirmer_key);
              res = await client.broadcast.comment(payload, postingKey);
            } else {
              logger.log("[error][steemcomment]", payload);
              res = {};
            }

            resolve({payload: payload, result: res});
          }
        } catch (err) {
          reject(err);
        }
      } else {
        let err = 'Missing posting key';
        reject(err);
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
