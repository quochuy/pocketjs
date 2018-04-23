var config = {};

config.steem = {};
config.steem.rpcNodes = ["https://rpc.buildteam.io","https://gtg.steem.house:8090","https://steemd.privex.io/","http://steemd.pevo.science/","http://steemd.minnowsupportproject.org/"];
config.steem.username = 'defakator';
config.steem.postingKey = '5KJikSSs2oixzrHwsuj4gnnRXhuY6RcwG7aWRhNFQQwTg6GFN9J';

config.pocket = {};
config.pocket.confirmMessage = 'Thanks for using POCKET! I am running [this confirmer code.](https://github.com/quochuy/pocketks)';
config.pocket.confirmationEnabled = false;
config.pocket.voteOnValidConfirmation = false;

module.exports = config;
