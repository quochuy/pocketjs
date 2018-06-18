const dsteem = require('dsteem');
const logger = require('logger');
const client = new dsteem.Client('https://api.steemit.com');

const steemhelper = {
  config: require('../configs/teamvn.json'),

  formatter: {
    // https://github.com/steemit/steem-js/blob/master/src/formatter.js
    reputation: function(reputation) {
      if (reputation == null) return reputation;
      reputation = parseInt(reputation);
      let rep = String(reputation);
      const neg = rep.charAt(0) === "-";
      rep = neg ? rep.substring(1) : rep;
      const str = rep;
      const leadingDigits = parseInt(str.substring(0, 4));
      const log = Math.log(leadingDigits) / Math.log(10);
      const n = str.length - 1;
      let out = n + (log - parseInt(log));
      if (isNaN(out)) out = 0;
      out = Math.max(out - 9, 0);
      out = (neg ? -1 : 1) * out;
      out = out * 9 + 25;
      out = parseInt(out);
      return out;
    },

    commentPermlink: function(parentAuthor, parentPermlink) {
      const timeStr = new Date()
        .toISOString()
        .replace(/[^a-zA-Z0-9]+/g, "")
        .toLowerCase();
      parentPermlink = parentPermlink.replace(/(-\d{8}t\d{9}z)/g, "");
      return "re-" + parentAuthor.replace(/[^a-zA-Z0-9]+/g, "") + "-" + parentPermlink + "-" + timeStr;
    }
  },

  upvote: async function(author, permlink, weight) {
    return new Promise(async function(resolve, reject) {
      if (typeof weight === 'undefined') {
        weight = 10000;
      }

      const postingKey = dsteem.PrivateKey.fromString(steemhelper.config.bot.steem.postingKey);

      try {
        const result = await client.broadcast.vote({
          voter: steemhelper.config.bot.steem.account,
          author: author,
          permlink: permlink,
          weight: weight
        }, postingKey);

        resolve(result);
      } catch(error) {
        logger.log("[Error][broadcast_vote]", error);

        if (error.jse_shortmsg.indexOf('You have already voted in a similar way')) {
          logger.log("Already voted");
        }

        reject(error);
      }
    });
  },

  comment: function(post, comment) {
    return new Promise(async function(resolve, reject) {
      try {
        if (post && comment) {
          const permlink = steemhelper.formatter.commentPermlink(post.author, post.permlink);
          const payload = {
            author: 'teamvn',
            permlink: permlink,
            parent_author: post.author,
            parent_permlink: post.permlink,
            title: '',
            body: comment,
            json_metadata: "{\"tags\":[\""+ post.category +"\"],\"app\":\"teamvn-bot\"}"
          };

          const postingKey = dsteem.PrivateKey.fromString(steemhelper.config.bot.steem.postingKey);
          const res = await client.broadcast.comment(payload, postingKey);
          logger.log("[success][steemcomment]", payload, res);
          resolve({payload: payload, result: res});
        }
      } catch(err) {
        logger.log("[error][comment]", err);
        reject(err);
      }
    });
  },

  getAuthorPermlinkFromUrl: function(url) {
    const authorPermlink = url.split('@').pop().split('/');
    return {
      author: authorPermlink[0],
      permlink: authorPermlink[1]
    }
  }
};

module.exports = steemhelper;