const { promptUser } = require("./sign_and_send")

const proceedAnyways = async message => {
  const answer = await promptUser(message + " Continue anyway? [yN] ")
  if (answer === "y" || answer.toLowerCase() === "yes") {
    return true
  }
  return false
}
module.exports = {
  proceedAnyways,
}
