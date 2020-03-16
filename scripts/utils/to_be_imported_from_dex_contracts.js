const getOrdersPaginated = async (instance, pageSize) => {
  const exchangeUtils = require("@gnosis.pm/dex-contracts")
  let orders = []
  let currentUser = "0x0000000000000000000000000000000000000000"
  let currentOffSet = 0
  let lastPageSize = pageSize
  while (lastPageSize == pageSize) {
    const page = exchangeUtils.decodeOrdersBN(await instance.getEncodedUsersPaginated(currentUser, currentOffSet, pageSize))
    orders = orders.concat(page)
    for (const index in page) {
      if (page[index].user != currentUser) {
        currentUser = page[index].user
        currentOffSet = 0
      }
      currentOffSet += 1
    }
    lastPageSize = page.length
  }
  return orders
}

const BN = require("bn.js")


const COLORS = {
  NONE: "\x1b[0m",
  RED: "\x1b[31m",
  YELLOW: "\x1b[33m",
}

const formatAmount = function(amount) {
  const string = amount.toString()
  if (string.length > 4) {
    return `${string.substring(0, 2)} * 10^${string.length - 2}`
  } else {
    return string
  }
}

const colorForValidFrom = function(order, currentBatchId) {
  let color = COLORS.NONE
  if (order.validFrom >= currentBatchId) {
    color = COLORS.RED
    if (order.validFrom - 5 <= currentBatchId) {
      color = COLORS.YELLOW
    }
  }
  return color
}

const colorForValidUntil = function(order, currentBatchId) {
  let color = COLORS.NONE
  if (order.validUntil - 5 <= currentBatchId) {
    color = COLORS.YELLOW
    if (order.validUntil <= currentBatchId) {
      color = COLORS.RED
    }
  }
  return color
}

const colorForRemainingAmount = function(order) {
  if (
    order.priceDenominator > 0 &&
    order.remainingAmount
      .mul(new BN(100))
      .div(order.priceDenominator)
      .toNumber() < 1
  ) {
    return COLORS.YELLOW
  } else {
    return COLORS.NONE
  }
}

const printOrder = function(order, currentBatchId) {
  console.log("{")
  console.log(`  user: ${order.user}`)
  console.log(`  sellTokenBalance: ${formatAmount(order.sellTokenBalance)}`)
  console.log(`  buyToken: ${order.buyToken}`)
  console.log(`  sellToken: ${order.sellToken}`)
  console.log(`  ${colorForValidFrom(order, currentBatchId)}validFrom: ${new Date(order.validFrom * 300 * 1000)}${COLORS.NONE}`)
  console.log(
    `  ${colorForValidUntil(order, currentBatchId)}validUntil: ${new Date(order.validUntil * 300 * 1000)}${COLORS.NONE}`
  )
  console.log(`  price: Sell ${formatAmount(order.priceDenominator)} for at least ${formatAmount(order.priceNumerator)}`)
  console.log(`  ${colorForRemainingAmount(order)}remaining: ${formatAmount(order.remainingAmount)}${COLORS.NONE}`)
  console.log("}")
}

module.exports ={
  getOrdersPaginated,
  printOrder
}
