var steemtools = {
  commentPermlink: function(parentAuthor, parentPermlink) {
    const timeStr = new Date()
      .toISOString()
      .replace(/[^a-zA-Z0-9]+/g, "")
      .toLowerCase();
    parentPermlink = parentPermlink.replace(/(-\d{8}t\d{9}z)/g, "");
    return "re-" + parentAuthor + "-" + parentPermlink + "-" + timeStr;
  }
}

module.exports = steemtools;