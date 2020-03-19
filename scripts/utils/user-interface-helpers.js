module.exports = function(web3 = web3, artifacts = artifacts) {
  const { promptUser } = require("./sign_and_send")(web3, artifacts)

  const proceedAnyways = async message => {
    const answer = await promptUser(message + " Continue anyway? [yN] ")
    if (answer === "y" || answer.toLowerCase() === "yes") {
      return true
    }
    return false
  }
  return {
    proceedAnyways,
  }
}