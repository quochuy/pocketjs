const steemHelper = require('./steemhelper');
const fs = require('fs');
const config = require('../config/config.json');
const validator = require('./validator');
const logger = require('./logger');

Array.prototype.remove = function() {
  let what, a = arguments, L = a.length, ax;
  while (L && this.length) {
    what = a[--L];
    while ((ax = this.indexOf(what)) !== -1) {
      this.splice(ax, 1);
    }
  }
  return this;
};

const voter = {
  dbFname: __dirname + '/../database/votes.json',
  votes_cast: null,
  pending_votes: [],

  init: function() {
    logger.log('Initializing voter module');

    try {
      this.votes_cast = require(this.dbFname);
    } catch (err) {
      this.reset();
    }

    setInterval(voter.vote, 7000);
  },

  reset: function() {
    this.votes_cast = [];
    this.save();
  },

  save: function(fname, data) {
    if (typeof fname === 'undefined') {
      fname = this.dbFname;
    }

    if (typeof data === 'undefined') {
      data = this.votes_cast;
    }

    fs.writeFileSync(fname, JSON.stringify(data));
  },

  mark_for_voting: function(op) {
    // add vote if active and if it's not for myself
    if (config.vote_on_valid_confs) {
      if (op[1].author !== config['confirmer-account']) {
        const ident = validator.constIdent(op[1].author,op[1].permlink);

        // make sure ident isn't in cast or pending:
        if (voter.votes_cast.indexOf(ident) === -1 && voter.pending_votes.indexOf(ident) === -1) {
          voter.pending_votes.push(ident);
        }
      }
    }
  },

  vote: function() {
    if (config.vote_on_valid_confs) {
      if (voter.pending_votes.length > 0) {
        const randomIndex = Math.floor((Math.random() * voter.pending_votes.length) + 1);
        const ident_to_vote = voter.pending_votes[randomIndex];
        const authorPermlink = steemHelper.getAuthorPermlinkFromUrl(ident_to_vote);
        steemHelper.upvote(
          authorPermlink.author,
          authorPermlink.permlink,
          1000,
          function() {
            logger.log('voted for confirmation ' + ident_to_vote);

            voter.pending_votes.remove(ident_to_vote);
            voter.votes_cast.push(ident_to_vote);
          },
          function(err) {
            voter.pending_votes.remove(ident_to_vote);
          }
        );
      }
    }
  }
};

module.exports = voter;