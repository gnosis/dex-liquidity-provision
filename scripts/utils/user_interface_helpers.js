const readline = require("readline")
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const promptUser = function (message) {
  return new Promise((resolve) => rl.question(message, (answer) => resolve(answer)))
}

const proceedAnyways = async function (message) {
  const answer = await promptUser(message + " Continue anyway? [yN] ")
  if (answer === "y" || answer.toLowerCase() === "yes") {
    return true
  }
  return false
}

module.exports = {
  proceedAnyways,
  promptUser,
}
