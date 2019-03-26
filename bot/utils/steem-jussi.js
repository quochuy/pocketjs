const rp = require('request-promise');

const jussi = {
  getBlocks: function(fromBlockNumber = 1, limit = 100) {
    return new Promise(function(resolve, reject) {
      let requestBody = [];
      for(let ri=0; ri<limit; ri++) {
        const blockNumber = fromBlockNumber + ri;
        requestBody.push({jsonrpc: "2.0", method: "condenser_api.get_block", params: [blockNumber], id: ri});
      }

      const options = {
        method: 'POST',
        uri: 'https://api.steemit.com',
        body: requestBody,
        json: true,
      };

      rp(options)
        .then(function (response) {
          if (response.hasOwnProperty('error')) {
            reject(response.error.message);
          } else {
            const blocks = [];
            for(let ri=0; ri<response.length; ri++) {
              const result = response[ri];
              blocks.push(result.result);
            }

            resolve(blocks);
          }
        })
        .catch(reject);
    });
  }
};

module.exports = jussi;