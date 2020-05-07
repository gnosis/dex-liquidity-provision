const BN = require("bn.js")

const MAX_UINT_128 = new BN(2).pow(new BN(128)).sub(new BN(1))

// see https://github.com/gnosis/dex-liquidity-provision/issues/203#issuecomment-624772889 for details
const ORDER_AMOUNT_MARGIN = new BN(10).pow(new BN(9))
const MAX_ORDER_AMOUNT = MAX_UINT_128.div(ORDER_AMOUNT_MARGIN)

module.exports = {
  MAX_ORDER_AMOUNT,
}
