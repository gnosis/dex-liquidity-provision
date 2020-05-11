module.exports = function (web3 = web3, artifacts = artifacts) {
  const readline = require("readline")

  const promptUser = function (message) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    return new Promise((resolve) => rl.question(message, (answer) => resolve(answer)))
  }

  const proceedAnyways = async (message) => {
    const answer = await promptUser(message + " Continue anyway? [yN] ")
    if (answer === "y" || answer.toLowerCase() === "yes") {
      return true
    }
    return false
  }
  return {
    proceedAnyways,
    promptUser,
  }
}
