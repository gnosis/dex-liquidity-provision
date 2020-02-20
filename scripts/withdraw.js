const { genericExecWithdraw, argv } = require("./request_withdraw")

module.exports = async callback => {
  try {
    await genericExecWithdraw("withdraw")

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
