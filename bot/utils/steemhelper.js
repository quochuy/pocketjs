const logger = require('./logger');
const database = require('./mistdb');
const dsteem = require('dsteem');
const _ = require('lodash');
const jussi = require('./steem-jussi');
const tools = require('./tools');
const moment = require('moment');
let client;

const steemhelper = {
  config: require('../config/config.json'),
  progress: {},
  blockIterator: null,
  isCatchingUp: true,
  headBlockNumber: 0,

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
   * @param opFoundCallback       Callback function to receive matching operations
   * @param blockParsedCallback   Callback function to notify when a block has been parsed
   * @param useJussi              Use Jussi to batch block requests
   * @returns {Promise<void>}
   */
  processBlockChain: async function (startBlockNumber, headBlockNumber, opFoundCallback, blockParsedCallback, useJussi = false) {
    steemhelper.last_processed_transaction_id = database.last_tx_id();
    steemhelper.last_processed_block_number = database.last_parsed_block();
    steemhelper.interrupted = database.was_interrupted();
    steemhelper.headBlockNumber = headBlockNumber;

    setInterval(function() {
      client.blockchain.getCurrentBlockNum()
        .then(function(headBlockNumber) {
          steemhelper.headBlockNumber = headBlockNumber;
        });
    }, 30000);

    let jussiBatchSize = 50;
    let jussiBatchNumber = 4;

    if (typeof opFoundCallback === "function") {
      let keepLooping = true;
      while (keepLooping !== false) {
        let blocks = [];

        try {
          // Using JUSSI, allows us to optimise block fetching and get to the head block as soon as possible.
          if (useJussi === true) {
            // If we are at headblock then try to fetch one block ahead, just in case we are a bit behind
            if (startBlockNumber >= steemhelper.headBlockNumber) {
              jussiBatchSize = 2;
              jussiBatchNumber = 1;

              // Let not overload the JUSSI server, there is only 1 block every 3 seconds after all
              await tools.sleep(2500);

              // If we are falling behind, try to catchup by increasing the batch size
            } else if ((startBlockNumber < (steemhelper.headBlockNumber - 10)) && (steemhelper.headBlockNumber - startBlockNumber < 50)) {
              jussiBatchSize = steemhelper.headBlockNumber - startBlockNumber + 5;
              jussiBatchNumber = 1;
            } else {
              jussiBatchSize = 50;
              jussiBatchNumber = 4;
            }

            blocks = await jussi.getBlocks(startBlockNumber, jussiBatchSize, jussiBatchNumber);
          }  else {
            blocks = await steemhelper.getNextBlocks(startBlockNumber);
          }
        } catch(err) {
          logger.log("[error] failed fetching next blocks", err);
        }

        for(let bi=0; bi<blocks.length; bi++) {
          const block = blocks[bi];
          if (block) {
            startBlockNumber++;

            if (block.hasOwnProperty('transactions') && block.transactions.length > 0) {
              const blockNumber = block.transactions[0].block_num;

              if (blockNumber < database.last_parsed_block()) {
                if (steemhelper.config.mode.debug >= 1) {
                  logger.log(`[Debug][processBlockChain] Skipped already processed block with number: ${blockNumber}`);
                }
              }

              try {
                await steemhelper.processBlock(block, opFoundCallback);
                if (typeof blockParsedCallback === 'function') {
                  await blockParsedCallback(blockNumber);
                }
              } catch(err) {
                logger.log("[error] processing block", err);
              }
            } else {
              if (steemhelper.config.mode.debug >= 1) {
                logger.log(`[Debug][processBlockChain] Block contains no transaction`);
              }
            }
          } else {
            steemhelper.isCatchingUp = false;

            if (startBlockNumber < steemhelper.headBlockNumber && useJussi === false) {
              throw "A block is null...";
            }
          }
        }
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
      logger.log("[Error][getNextBlocks]", error);
      logger.log("[Error][getNextBlocks][current_block_number]", block_number);

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

          return [];
        } else {
          throw "Lost connection to RPC and cannot reconnect";
        }
      } else {
        throw `Unknown error ${error.message}`;
      }
    }
  },

  /**
   * Get a block and process its transactions
   *
   * @param opFoundCallback
   * @returns {Promise<void>}
   */
  processBlock: async function (block, opFoundCallback) {
    const blockNumber = block.transactions[0].block_num;
    if (steemhelper.config.mode.debug >= 1) {
      logger.log(`[Debug][block] #${blockNumber} at ${block.timestamp}`);
    }

    for(let ti=0; ti<block.transactions.length; ti++) {
      const transaction = block.transactions[ti];
      steemhelper.processTransaction(block.timestamp, blockNumber, transaction, opFoundCallback)
    }

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
   * @param opFoundCallback
   * @returns {Promise<void>}
   */
  processTransaction: async function (blockTimestamp, blockNumber, transaction, opFoundCallback) {
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
      for(let oi=0; oi<transaction.operations.length; oi++) {
        const operation = transaction.operations[oi];
        steemhelper.processOperation(blockTimestamp, operation, blockNumber, trxid, opFoundCallback)
      }

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
   * @param opFoundCallback
   * @returns {Promise<void>}
   */
  processOperation: async function (blockTimestamp, operation, blockNumber, trxid, opFoundCallback) {
    if (
      operation
      && operation[0]
      && (
        operation[0].toLowerCase() === 'comment'
        || operation[0].toLowerCase() === 'custom_json'
      )
      && operation[1]) {
      if (typeof opFoundCallback === 'function') {
        opFoundCallback(blockTimestamp, operation, blockNumber, trxid);
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
  upvote: async function (author, permlink, weight) {
    if (typeof weight === 'undefined') {
      weight = 10000;
    }

    try {
      const postingKey = dsteem.PrivateKey.fromString(steemhelper.config.confirmer_key);
      const result = await client.broadcast.vote({
        voter: steemhelper.config.confirmer_account,
        author: author,
        permlink: permlink,
        weight: weight
      }, postingKey);

      return result;
    } catch (error) {
      logger.log("[Error][broadcast_vote]", error);

      if (error.indexOf('You have already voted in a similar way')) {
        logger.log("Already voted");
      }

      throw error;
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
    if (url) {
      const authorPermlink = url.split('@').pop().split('/');
      return {
        author: authorPermlink[0],
        permlink: authorPermlink[1]
      }
    }

    return false;
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
  },

  /**
   *
   * @param account
   * @returns {Promise<*>}
   */
  getRcMana: async function(account) {
    try {
      return await client.rc.getRCMana(account);
    } catch (err) {
      logger.log("[error][getRcAccounts]", err);
    }
  },

  /**
   *
   * @param account
   * @returns {Promise<*>}
   */
  getVpMana: async function(account) {
    try {
      return await client.rc.getVPMana(account);
    } catch (err) {
      logger.log("[error][getVpMana]", err);
    }
  }
};

module.exports = steemhelper;
