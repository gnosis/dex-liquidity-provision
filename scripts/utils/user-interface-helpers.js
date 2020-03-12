const { promptUser } = require("./sign_and_send")

const proceedAnyways = async check => {
  if (!check) {
    const answer = await promptUser("Continue anyway? [yN] ")
    if (answer != "y" || answer.toLowerCase() != "yes") {
      return true
    }
    return false
  }
  return true
}
module.exports = {
  proceedAnyways,
}
